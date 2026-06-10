import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve } from 'path';
import type {
  AgentResult,
  LLMProvider,
  Message,
  ProjectConfig,
  ProjectProfile,
  ProviderToolCall,
  ProviderUsage,
  ToolDefinition,
  WritingAgent,
  WritingContextPacket,
} from '@openwriter/core';
import {
  ContextRetriever,
  ProseWriter,
  PlotArchitect,
  CharacterAgent,
  WorldbuildingAgent,
  StyleEditor,
  ContinuityChecker,
  Critic,
  MemoryCurator,
} from '@openwriter/agents';

const MAX_ITERATIONS = 15;
const MAX_TOOL_RESULT_CHARS = 60000;
const STORM_BREAK_THRESHOLD = 3;
const COMPACT_THRESHOLD_CHARS = 80000;
const COMPACT_KEEP_RECENT = 4;
const DEFAULT_READ_LINES = 320;
const MAX_READ_LINES = 1200;
const DEFAULT_RESULT_LIMIT = 200;
const MAX_RESULT_LIMIT = 800;

const IGNORED_DIRS = new Set([
  '.git',
  '.obsidian',
  '.qoder',
  '.vscode',
  'node_modules',
  'dist',
  'build',
  'release',
  'coverage',
]);

const TEXT_EXTENSIONS = new Set([
  '.adoc',
  '.css',
  '.csv',
  '.html',
  '.js',
  '.json',
  '.jsonl',
  '.jsx',
  '.log',
  '.md',
  '.markdown',
  '.mdx',
  '.rst',
  '.text',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

export interface ParsedAgentTurn {
  label: string;
  task: string;
  allowWrites: boolean;
  modeHint?: string;
}

export interface WritingAgentCallbacks {
  onThought?: (thought: string) => void;
  onToolStart?: (name: string, args: Record<string, unknown>) => void;
  onToolEnd?: (name: string, result: ToolExecutionResult) => void;
  onTextDelta?: (delta: string) => void;
}

export interface WritingAgentResult {
  content: string;
  diffs: string[];
  usage?: ProviderUsage;
}

export interface ToolExecutionResult {
  ok: boolean;
  summary: string;
  content: string;
  diff?: string;
  wrote?: boolean;
}

interface AgentTool {
  definition: ToolDefinition;
  writes: boolean;
  execute(args: Record<string, unknown>): Promise<ToolExecutionResult>;
}

export interface WritingAgentOptions {
  provider: LLMProvider;
  workDir: string;
  task: string;
  allowWrites: boolean;
  modeHint?: string;
  projectConfig?: ProjectConfig | null;
  callbacks?: WritingAgentCallbacks;
  /** AbortSignal for user interruption (Esc key, session switch, etc.) */
  signal?: AbortSignal;
}

export async function runWritingAgentTurn(options: WritingAgentOptions): Promise<WritingAgentResult> {
  if (!options.provider.chatWithTools) {
    throw new Error(`${options.provider.name} does not support tool calling`);
  }

  const runtime = new WritingToolRuntime(options.workDir, options.allowWrites, options.provider, options.projectConfig);
  const tools = runtime.tools.map(tool => tool.definition).sort((a, b) => {
    return a.function.name.localeCompare(b.function.name);
  });
  const messages: Message[] = [
    { role: 'system', content: buildSystemPrompt(options.projectConfig) },
    { role: 'user', content: buildUserPrompt(options.task, options.workDir, options.allowWrites, options.modeHint) },
  ];

  let accumulatedUsage: ProviderUsage | undefined;
  let finalContent = '';
  let stormSig = '';
  let stormCount = 0;

  const signal = options.signal;

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    // Check for user interruption at each iteration boundary
    if (signal?.aborted) {
      return {
        content: '[aborted by user] The task was interrupted. Re-run when ready.',
        diffs: runtime.diffs,
        usage: accumulatedUsage,
      };
    }

    options.callbacks?.onThought?.(iteration === 1 ? 'thinking...' : 'thinking with tool results...');
    const response = await options.provider.chatWithTools(messages, tools, {
      temperature: 0.25,
      maxTokens: 4096,
    });
    accumulatedUsage = mergeProviderUsage(accumulatedUsage, response.usage ?? options.provider.getLastUsage?.());

    if (!response.toolCalls.length) {
      finalContent = response.content || 'Done.';
      options.callbacks?.onTextDelta?.(finalContent);
      return {
        content: finalContent,
        diffs: runtime.diffs,
        usage: accumulatedUsage,
      };
    }

    messages.push({
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls,
    });

    // Split tool calls into read-only (parallelizable) and write (serial)
    const readOnlyCalls = response.toolCalls.filter(c => !runtime.isWriteTool(c));
    const writeCalls = response.toolCalls.filter(c => runtime.isWriteTool(c));

    // Execute read-only calls in parallel
    const readResults = await Promise.all(
      readOnlyCalls.map(async toolCall => {
        if (signal?.aborted) return { toolCall, result: abortResult() };
        return { toolCall, result: await runtime.executeToolCall(toolCall, options.callbacks) };
      }),
    );

    // Execute write calls serially
    const writeResults: Array<{ toolCall: ProviderToolCall; result: ToolExecutionResult }> = [];
    for (const toolCall of writeCalls) {
      if (signal?.aborted) {
        return {
          content: '[aborted by user] The task was interrupted during tool execution. Partial results may be available.',
          diffs: runtime.diffs,
          usage: accumulatedUsage,
        };
      }
      writeResults.push({ toolCall, result: await runtime.executeToolCall(toolCall, options.callbacks) });
    }

    // Merge results back in original call order
    const allResults = [...readResults, ...writeResults];
    const resultMap = new Map(allResults.map(r => [r.toolCall.id, r]));
    for (const toolCall of response.toolCalls) {
      const { result } = resultMap.get(toolCall.id)!;
      messages.push({
        role: 'tool',
        toolCallId: toolCall.id,
        name: toolCall.function.name,
        content: truncateToolResult(result.content),
      });
    }

    // Storm breaker: detect repeated identical failures
    const batchSig = computeBatchSignature(response.toolCalls, allResults);
    if (batchSig && batchSig === stormSig) {
      stormCount++;
      if (stormCount >= STORM_BREAK_THRESHOLD) {
        const lastIdx = messages.length - 1;
        messages[lastIdx] = {
          ...messages[lastIdx],
          content: messages[lastIdx].content + `\n\n[loop guard] The same tool has failed ${stormCount} times in a row with the same error. Re-trying will not help. Change approach: use different arguments, a different tool, or explain the blocker in your final answer.`,
        };
      }
    } else if (batchSig) {
      stormSig = batchSig;
      stormCount = 1;
    } else {
      stormSig = '';
      stormCount = 0;
    }

    // Context compaction: summarize old messages when they grow too large
    await maybeCompactMessages(messages, options.provider);
  }

  // 达到迭代限制时，强制生成总结而不是抛出错误
  finalContent = '[iteration limit reached] The agent ran for ' + MAX_ITERATIONS + ' tool iterations. Generating a summary of what was accomplished.';
  options.callbacks?.onTextDelta?.(finalContent);
  return {
    content: finalContent,
    diffs: runtime.diffs,
    usage: accumulatedUsage,
  };
}

function buildSystemPrompt(projectConfig?: ProjectConfig | null): string {
  const profile = projectConfig
    ? [
      `Project: ${projectConfig.project.name}`,
      `Language: ${projectConfig.project.language}`,
      `Genre: ${projectConfig.project.genre}`,
      `Style profile: ${projectConfig.style.proseProfile}`,
    ].join('\n')
    : 'No OpenWriter project profile is required. Treat the workspace as an arbitrary writing/code-like project.';

  return [
    'You are OpenWriter, a writing-focused coding agent.',
    'Work like a coding agent over files: inspect the workspace, decide what context is relevant, and call tools only when needed.',
    'Do not assume any fixed folder layout such as canon/, chapters/, drafts/, or settings/. Discover the project structure with list_dir, glob, grep, and read_file.',
    '',
    'FILE TOOLS: list_dir, glob, grep, read_file, edit_file, write_file',
    'CONTEXT TOOL: gather_context — scan the workspace and gather relevant files for a writing task',
    'SPECIALIST TOOLS (call for deep expert analysis):',
    '- analyze_plot: plot structure, causality, conflict arcs, pacing, foreshadowing',
    '- analyze_characters: character motivation, arcs, relationships, OOC detection',
    '- check_continuity: canon contradictions, timeline errors',
    '- review_style: prose quality, translationese, AI taste, repetition, POV',
    '- check_worldbuilding: world consistency, institutions, geography, magic systems',
    '- critique: broad multi-dimensional review (structure + character + pacing + prose)',
    '- curate_memory: extract new canon, track changes, organize lore',
    '- write_prose: draft new manuscript text grounded in project context',
    '',
    'MEMORY TOOLS:',
    '- curate_memory: analyze recent writing to extract setting changes, character updates, timeline shifts. Returns a changelog of proposed changes.',
    '- save_canon: persist a canon entry (character, setting, timeline) to the workspace canon/ directory. Use after curate_memory to make changes permanent across sessions.',
    '',
    'MEMORY WORKFLOW:',
    '1. After writing a chapter or scene, call curate_memory to identify new lore.',
    '2. Review the changelog, then call save_canon for each confirmed entry.',
    '3. Next session\'s gather_context will automatically pick up saved canon from canon/.',
    '',
    'DECISION RULES:',
    '1. Simple file questions → read_file and answer directly.',
    '2. "Check my plot/chapter" → gather_context first, then the relevant specialist.',
    '3. "Write the next scene" → gather_context first, then write_prose (or write_file).',
    '4. Broad review → critique. Narrow review → specific specialist.',
    '5. Multiple specialists OK for thorough reviews.',
    '6. Always present specialist results as readable prose, not raw JSON.',
    '7. Only call write_file or edit_file when the user explicitly asks to change files.',
    '',
    'Never infer a target file from retrieval and overwrite it. Read the exact file first before editing.',
    'Do not expose raw request/response JSON or internal implementation details to the user.',
    '',
    profile,
  ].join('\n');
}

function buildUserPrompt(task: string, workDir: string, allowWrites: boolean, modeHint?: string): string {
  return [
    `Workspace root: ${workDir}`,
    `Write tools: ${allowWrites ? 'available for explicit requested edits' : 'disabled for this turn'}`,
    modeHint ? `Mode hint: ${modeHint}` : '',
    '',
    'User task:',
    task,
  ].filter(Boolean).join('\n');
}

class WritingToolRuntime {
  private readonly readFiles = new Set<string>();
  private cachedContextPacket: WritingContextPacket | null = null;
  readonly diffs: string[] = [];
  readonly tools: AgentTool[];

  constructor(
    private readonly workDir: string,
    private readonly allowWrites: boolean,
    private readonly provider: LLMProvider,
    private readonly projectConfig?: ProjectConfig | null,
  ) {
    const readOnlyTools: AgentTool[] = [
      this.listDirTool(),
      this.globTool(),
      this.grepTool(),
      this.readFileTool(),
    ];
    const writeTools: AgentTool[] = [
      this.editFileTool(),
      this.writeFileTool(),
    ];
    const contextTool: AgentTool = this.gatherContextTool();
    const specialistTools: AgentTool[] = [
      this.makeSpecialistTool('analyze_plot', 'Analyze plot structure, causality, conflict intensity, pacing, and foreshadowing.', () => new PlotArchitect(provider)),
      this.makeSpecialistTool('analyze_characters', 'Analyze character motivations, arcs, relationships, and detect out-of-character behavior.', () => new CharacterAgent(provider)),
      this.makeSpecialistTool('check_continuity', 'Check for canon contradictions, timeline errors, and relationship conflicts.', () => new ContinuityChecker(provider)),
      this.makeSpecialistTool('review_style', 'Review prose quality: translationese, AI taste, repetition, POV consistency, register.', () => new StyleEditor(provider)),
      this.makeSpecialistTool('check_worldbuilding', 'Check world consistency: institutions, geography, culture, technology, magic systems, terminology.', () => new WorldbuildingAgent(provider)),
      this.makeSpecialistTool('critique', 'Broad multi-dimensional review covering structure, character, pacing, setting, and prose.', () => new Critic(provider)),
      this.makeSpecialistTool('curate_memory', 'Extract new canon, track setting/character/timeline changes, generate changelog.', () => new MemoryCurator(provider)),
      this.makeSpecialistTool('write_prose', 'Draft new manuscript text (chapter, scene, paragraph) grounded in project context.', () => new ProseWriter(provider)),
    ];
    this.tools = allowWrites
      ? [...readOnlyTools, ...writeTools, contextTool, this.saveCanonTool(), ...specialistTools]
      : [...readOnlyTools, contextTool, ...specialistTools];
  }

  async executeToolCall(
    toolCall: ProviderToolCall,
    callbacks?: WritingAgentCallbacks,
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.find(item => item.definition.function.name === toolCall.function.name);
    if (!tool) {
      return {
        ok: false,
        summary: `unknown tool: ${toolCall.function.name}`,
        content: `Tool error: unknown tool ${toolCall.function.name}`,
      };
    }

    callbacks?.onToolStart?.(tool.definition.function.name, toolCall.parsedArguments);
    try {
      if (tool.writes && !this.allowWrites) {
        return {
          ok: false,
          summary: `${tool.definition.function.name} blocked`,
          content: 'Tool error: write tools are disabled for this read-only turn.',
        };
      }
      const result = await tool.execute(toolCall.parsedArguments);
      if (result.diff) this.diffs.push(result.diff);
      callbacks?.onToolEnd?.(tool.definition.function.name, result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const result: ToolExecutionResult = {
        ok: false,
        summary: `${tool.definition.function.name} failed`,
        content: `Tool error: ${message}`,
      };
      callbacks?.onToolEnd?.(tool.definition.function.name, result);
      return result;
    }
  }

  isWriteTool(toolCall: ProviderToolCall): boolean {
    const tool = this.tools.find(item => item.definition.function.name === toolCall.function.name);
    return tool?.writes ?? false;
  }

  private listDirTool(): AgentTool {
    return {
      writes: false,
      definition: defineTool('list_dir', 'List files and directories inside the workspace.', {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path relative to the workspace. Defaults to ".".' },
          limit: { type: 'number', description: 'Maximum number of entries to return.' },
        },
      }),
      execute: async args => {
        const target = this.resolvePath(optionalString(args.path) ?? '.');
        if (!existsSync(target.absolute)) return toolOk(`directory not found: ${target.relative}`, `directory not found: ${target.relative}`);
        const stats = statSync(target.absolute);
        if (!stats.isDirectory()) return toolOk(`not a directory: ${target.relative}`, `not a directory: ${target.relative}`);

        const limit = clampNumber(args.limit, DEFAULT_RESULT_LIMIT, 1, MAX_RESULT_LIMIT);
        const entries = readdirSync(target.absolute, { withFileTypes: true })
          .filter(entry => !IGNORED_DIRS.has(entry.name))
          .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
          .slice(0, limit);
        const lines = entries.map(entry => `${entry.isDirectory() ? 'dir ' : 'file'} ${entry.name}`);
        return toolOk(`listed ${target.relative}`, [`path: ${target.relative}`, ...lines].join('\n'));
      },
    };
  }

  private globTool(): AgentTool {
    return {
      writes: false,
      definition: defineTool('glob', 'Find files by glob pattern inside the workspace.', {
        type: 'object',
        required: ['pattern'],
        properties: {
          pattern: { type: 'string', description: 'Glob pattern such as **/*.md or *.txt.' },
          path: { type: 'string', description: 'Directory to search from. Defaults to ".".' },
          limit: { type: 'number', description: 'Maximum number of paths to return.' },
        },
      }),
      execute: async args => {
        const pattern = requiredString(args.pattern, 'pattern');
        const base = this.resolvePath(optionalString(args.path) ?? '.');
        const limit = clampNumber(args.limit, DEFAULT_RESULT_LIMIT, 1, MAX_RESULT_LIMIT);
        const matcher = globMatcher(pattern);
        const files = walkFiles(this.workDir, base.absolute)
          .map(file => normalizePath(relative(this.workDir, file)))
          .filter(file => matcher(file) || matcher(file.split('/').at(-1) ?? file))
          .slice(0, limit);
        return toolOk(`matched ${files.length} file(s)`, files.length ? files.join('\n') : 'no files matched');
      },
    };
  }

  private grepTool(): AgentTool {
    return {
      writes: false,
      definition: defineTool('grep', 'Search text files by plain text or regular expression.', {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Text or regex to search for.' },
          path: { type: 'string', description: 'File or directory path. Defaults to ".".' },
          regex: { type: 'boolean', description: 'Treat query as a regular expression.' },
          case_sensitive: { type: 'boolean', description: 'Use case-sensitive matching.' },
          limit: { type: 'number', description: 'Maximum number of matches to return.' },
        },
      }),
      execute: async args => {
        const query = requiredString(args.query, 'query');
        const target = this.resolvePath(optionalString(args.path) ?? '.');
        const limit = clampNumber(args.limit, DEFAULT_RESULT_LIMIT, 1, MAX_RESULT_LIMIT);
        const matcher = makeLineMatcher(query, Boolean(args.regex), Boolean(args.case_sensitive));
        const files = existsSync(target.absolute) && statSync(target.absolute).isFile()
          ? [target.absolute]
          : walkFiles(this.workDir, target.absolute);
        const matches: string[] = [];

        for (const file of files) {
          if (matches.length >= limit) break;
          if (!isTextFile(file) || statSync(file).size > 2_000_000) continue;
          const content = readFileSync(file, 'utf-8');
          const lines = content.split(/\r?\n/);
          for (let index = 0; index < lines.length; index++) {
            if (!matcher(lines[index])) continue;
            const rel = normalizePath(relative(this.workDir, file));
            matches.push(`${rel}:${index + 1}: ${trimLine(lines[index], 240)}`);
            if (matches.length >= limit) break;
          }
        }

        return toolOk(`found ${matches.length} match(es)`, matches.length ? matches.join('\n') : 'no matches');
      },
    };
  }

  private readFileTool(): AgentTool {
    return {
      writes: false,
      definition: defineTool('read_file', 'Read a text file with line numbers.', {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'File path relative to the workspace.' },
          offset: { type: 'number', description: '1-based starting line. Defaults to 1.' },
          limit: { type: 'number', description: 'Maximum number of lines to read.' },
        },
      }),
      execute: async args => {
        const target = this.resolvePath(requiredString(args.path, 'path'));
        if (!existsSync(target.absolute)) return toolOk(`file not found: ${target.relative}`, `file not found: ${target.relative}`);
        if (!statSync(target.absolute).isFile()) return toolOk(`not a file: ${target.relative}`, `not a file: ${target.relative}`);
        if (!isTextFile(target.absolute)) return toolOk(`not a text file: ${target.relative}`, `not a text file: ${target.relative}`);

        const content = readFileSync(target.absolute, 'utf-8');
        const lines = content.split(/\r?\n/);
        const offset = clampNumber(args.offset, 1, 1, Math.max(lines.length, 1));
        const limit = clampNumber(args.limit, DEFAULT_READ_LINES, 1, MAX_READ_LINES);
        const selected = lines.slice(offset - 1, offset - 1 + limit)
          .map((line, index) => `${String(offset + index).padStart(4, ' ')} | ${line}`);
        const omitted = offset - 1 + limit < lines.length
          ? `\n... ${lines.length - (offset - 1 + limit)} more line(s)`
          : '';
        this.readFiles.add(target.relative);
        return toolOk(`read ${target.relative}`, [`file: ${target.relative}`, ...selected].join('\n') + omitted);
      },
    };
  }

  private writeFileTool(): AgentTool {
    return {
      writes: true,
      definition: defineTool('write_file', 'Create a new text file or overwrite a file that has already been read this turn.', {
        type: 'object',
        required: ['path', 'content'],
        properties: {
          path: { type: 'string', description: 'File path relative to the workspace.' },
          content: { type: 'string', description: 'Full file content to write.' },
        },
      }),
      execute: async args => {
        const target = this.resolvePath(requiredString(args.path, 'path'));
        const content = requiredString(args.content, 'content');
        const exists = existsSync(target.absolute);
        if (exists && !this.readFiles.has(target.relative)) {
          return toolError(
            `write blocked for unread file: ${target.relative}`,
            `write_file refused to overwrite ${target.relative}. Call read_file first, then use edit_file or write_file.`,
          );
        }

        const before = exists ? readFileSync(target.absolute, 'utf-8') : '';
        mkdirSync(dirname(target.absolute), { recursive: true });
        writeFileSync(target.absolute, content, 'utf-8');
        this.readFiles.add(target.relative);
        const diff = createUnifiedDiff(target.relative, before, content);
        return {
          ok: true,
          wrote: true,
          summary: exists ? `wrote ${target.relative}` : `created ${target.relative}`,
          content: `${exists ? 'wrote' : 'created'} ${target.relative}\n\n${diff}`,
          diff,
        };
      },
    };
  }

  private editFileTool(): AgentTool {
    return {
      writes: true,
      definition: defineTool('edit_file', 'Edit an existing text file by exact search and replace. The file must be read first.', {
        type: 'object',
        required: ['path', 'old_text', 'new_text'],
        properties: {
          path: { type: 'string', description: 'File path relative to the workspace.' },
          old_text: { type: 'string', description: 'Exact text to replace.' },
          new_text: { type: 'string', description: 'Replacement text.' },
          replace_all: { type: 'boolean', description: 'Replace every occurrence. Defaults to false.' },
        },
      }),
      execute: async args => {
        const target = this.resolvePath(requiredString(args.path, 'path'));
        const oldText = requiredString(args.old_text, 'old_text');
        const newText = requiredString(args.new_text, 'new_text');
        const replaceAll = Boolean(args.replace_all);

        if (!existsSync(target.absolute)) return toolOk(`file not found: ${target.relative}`, `file not found: ${target.relative}`);
        if (!this.readFiles.has(target.relative)) {
          return toolError(
            `edit blocked for unread file: ${target.relative}`,
            `edit_file refused to edit ${target.relative}. Call read_file first so the edit is grounded in current content.`,
          );
        }

        const before = readFileSync(target.absolute, 'utf-8');
        const count = countOccurrences(before, oldText);
        if (count === 0) return toolError(`old_text not found in ${target.relative}`, `old_text not found in ${target.relative}`);
        if (count > 1 && !replaceAll) {
          return toolError(
            `old_text matched ${count} times in ${target.relative}`,
            `old_text matched ${count} times in ${target.relative}. Provide a more specific old_text or set replace_all.`,
          );
        }

        const after = replaceAll ? before.split(oldText).join(newText) : before.replace(oldText, newText);
        writeFileSync(target.absolute, after, 'utf-8');
        const diff = createUnifiedDiff(target.relative, before, after);
        return {
          ok: true,
          wrote: true,
          summary: `edited ${target.relative}`,
          content: `edited ${target.relative}\n\n${diff}`,
          diff,
        };
      },
    };
  }

  private resolvePath(path: string): { absolute: string; relative: string } {
    const absolute = resolve(this.workDir, path);
    const rel = relative(this.workDir, absolute);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`path escapes workspace: ${path}`);
    }
    return {
      absolute,
      relative: normalizePath(rel || '.'),
    };
  }

  private loadCanonEntries(): Array<{ source: string; status: 'idea' | 'candidate' | 'canon' | 'deprecated'; content: string; tags?: string[] }> {
    const canonDir = join(this.workDir, 'canon');
    if (!existsSync(canonDir) || !statSync(canonDir).isDirectory()) return [];

    const entries: Array<{ source: string; status: 'idea' | 'candidate' | 'canon' | 'deprecated'; content: string; tags?: string[] }> = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walk(join(dir, entry.name));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const absPath = join(dir, entry.name);
          const relPath = normalizePath(relative(this.workDir, absPath));
          const raw = readFileSync(absPath, 'utf-8');
          const parsed = parseFrontmatter(raw);
          entries.push({
            source: relPath,
            status: (parsed.status as 'idea' | 'candidate' | 'canon' | 'deprecated') ?? 'candidate',
            content: parsed.body,
            tags: parsed.category ? [parsed.category] : undefined,
          });
        }
      }
    };
    walk(canonDir);
    return entries;
  }

  private buildProjectProfile(): ProjectProfile {
    if (this.projectConfig) {
      return {
        name: this.projectConfig.project.name,
        language: this.projectConfig.project.language,
        genre: this.projectConfig.project.genre,
        sourceOfTruth: this.projectConfig.project.sourceOfTruth,
        draftDirs: this.projectConfig.project.draftDirs,
        style: {
          proseProfile: this.projectConfig.style.proseProfile,
          descriptionDensity: this.projectConfig.style.descriptionDensity as 'low' | 'medium' | 'high',
          dialogueStyle: this.projectConfig.style.dialogueStyle,
          pov: this.projectConfig.style.pov,
          taboo: this.projectConfig.style.taboo,
        },
        retrieval: this.projectConfig.retrieval,
        cache: this.projectConfig.cache,
      };
    }
    return { name: 'Untitled', language: 'en', genre: 'fiction' };
  }

  private gatherContextTool(): AgentTool {
    return {
      writes: false,
      definition: defineTool('gather_context', 'Scan the workspace and gather relevant files, canon, and drafts for a writing task. Call this before specialist tools to build context.', {
        type: 'object',
        required: ['task'],
        properties: {
          task: { type: 'string', description: 'The writing task or question to gather context for.' },
        },
      }),
      execute: async args => {
        const task = requiredString(args.task, 'task');

        // Scan canon/ directory for persistent memory entries
        const canonEntries = this.loadCanonEntries();

        const retriever = new ContextRetriever();
        const baseContext: WritingContextPacket = {
          task,
          projectProfile: this.buildProjectProfile(),
          relevantCanon: canonEntries,
          relevantDrafts: [],
          deprecatedItems: [],
          openQuestions: [],
          constraints: [],
        };
        const result = await retriever.execute(baseContext);
        const content = result.content as Record<string, unknown>;
        const packet = (content?.packet ?? baseContext) as WritingContextPacket;
        // Ensure canon entries from disk are preserved even if retriever replaces them
        if (canonEntries.length > 0 && packet.relevantCanon.length === 0) {
          packet.relevantCanon = canonEntries;
        }
        this.cachedContextPacket = packet;

        const summary = content?.summary as Record<string, unknown> | undefined;
        const lines: string[] = [];
        if (summary) {
          lines.push(`Found ${summary.draftCount ?? 0} file(s), ${canonEntries.length} canon, ${summary.deprecatedCount ?? 0} deprecated.`);
          const scores = summary.relevanceScores as Array<{ source: string; score: number }> | undefined;
          if (scores?.length) {
            lines.push('Top relevant files:');
            for (const s of scores.slice(0, 10)) {
              lines.push(`  - ${s.source} (score: ${s.score.toFixed(3)})`);
            }
          }
        }
        if (canonEntries.length > 0) {
          lines.push(`Canon entries loaded: ${canonEntries.map(e => e.source).join(', ')}`);
        }
        return {
          ok: true,
          summary: `gathered context for: ${task.slice(0, 60)}`,
          content: lines.join('\n') || 'Context gathered.',
        };
      },
    };
  }

  private saveCanonTool(): AgentTool {
    return {
      writes: true,
      definition: defineTool('save_canon', 'Persist a setting/character/timeline entry to the workspace canon/ directory so it is remembered across sessions. Use after curate_memory to make changes permanent.', {
        type: 'object',
        required: ['file', 'status', 'category', 'content'],
        properties: {
          file: { type: 'string', description: 'File name inside canon/ (e.g. "characters/林上" or "world-rules"). The .md extension is added automatically.' },
          status: { type: 'string', enum: ['idea', 'candidate', 'canon', 'deprecated'], description: 'Memory status. New entries default to "candidate".' },
          category: { type: 'string', enum: ['character', 'setting', 'timeline', 'other'], description: 'Entry category.' },
          content: { type: 'string', description: 'Markdown content describing the canon entry.' },
        },
      }),
      execute: async args => {
        const file = requiredString(args.file, 'file');
        const status = requiredString(args.status, 'status') as string;
        const category = requiredString(args.category, 'category');
        const content = requiredString(args.content, 'content');

        const canonDir = join(this.workDir, 'canon');
        const fileName = file.endsWith('.md') ? file : `${file}.md`;
        const filePath = join(canonDir, fileName);

        const target = this.resolvePath(join('canon', fileName));
        const now = new Date().toISOString().slice(0, 10);
        const frontmatter = `---\nstatus: ${status}\ncategory: ${category}\nupdated: ${now}\n---\n\n`;
        const fullContent = frontmatter + content;

        const existed = existsSync(target.absolute);
        mkdirSync(dirname(target.absolute), { recursive: true });
        writeFileSync(target.absolute, fullContent, 'utf-8');

        return {
          ok: true,
          wrote: true,
          summary: existed ? `updated canon: ${fileName}` : `created canon: ${fileName}`,
          content: `${existed ? 'updated' : 'created'} canon/${fileName} [${status}] (${category})`,
        };
      },
    };
  }

  private makeSpecialistTool(
    name: string,
    description: string,
    agentFactory: () => WritingAgent,
  ): AgentTool {
    return {
      writes: false,
      definition: defineTool(name, description, {
        type: 'object',
        required: ['task'],
        properties: {
          task: { type: 'string', description: 'What to analyze or do. Be specific about the text, chapter, or question.' },
          files: { type: 'array', items: { type: 'string' }, description: 'Optional list of file paths to focus on. If omitted, uses previously gathered context or scans the workspace.' },
        },
      }),
      execute: async args => {
        const task = requiredString(args.task, 'task');
        const files = Array.isArray(args.files) ? args.files.filter((f): f is string => typeof f === 'string') : undefined;

        const packet = await this.buildContextForSpecialist(task, files);
        const agent = agentFactory();
        const result = await agent.execute(packet, { quiet: true });
        return formatSpecialistResult(name, result);
      },
    };
  }

  private async buildContextForSpecialist(task: string, files?: string[]): Promise<WritingContextPacket> {
    if (this.cachedContextPacket && (!files || files.length === 0)) {
      return { ...this.cachedContextPacket, task };
    }

    if (files && files.length > 0) {
      const drafts: Array<{ source: string; content: string; lastModified?: string }> = [];
      for (const file of files) {
        const absPath = resolve(this.workDir, file);
        if (existsSync(absPath) && statSync(absPath).isFile()) {
          drafts.push({
            source: file,
            content: readFileSync(absPath, 'utf-8'),
            lastModified: statSync(absPath).mtime.toISOString(),
          });
        }
      }
      return {
        task,
        projectProfile: this.buildProjectProfile(),
        relevantCanon: [],
        relevantDrafts: drafts,
        deprecatedItems: [],
        openQuestions: [],
        constraints: [],
      };
    }

    const retriever = new ContextRetriever();
    const baseContext: WritingContextPacket = {
      task,
      projectProfile: this.buildProjectProfile(),
      relevantCanon: [],
      relevantDrafts: [],
      deprecatedItems: [],
      openQuestions: [],
      constraints: [],
    };
    const result = await retriever.execute(baseContext);
    const content = result.content as Record<string, unknown>;
    const packet = (content?.packet ?? baseContext) as WritingContextPacket;
    this.cachedContextPacket = packet;
    return packet;
  }
}

function formatSpecialistResult(toolName: string, result: AgentResult): ToolExecutionResult {
  if (result.type === 'text' && typeof result.content === 'string') {
    const truncated = result.content.length > 8000 ? result.content.slice(0, 8000) + '\n... [truncated]' : result.content;
    return { ok: true, summary: `${toolName}: generated text`, content: truncated };
  }

  if (typeof result.content === 'object' && !Array.isArray(result.content) && result.content !== null) {
    const obj = result.content as Record<string, unknown>;
    if ('changelog' in obj && typeof obj.changelog === 'string') {
      return { ok: true, summary: `${toolName}: found changes`, content: obj.changelog };
    }
    return { ok: true, summary: toolName, content: JSON.stringify(result.content, null, 2) };
  }

  if (Array.isArray(result.content)) {
    if (result.content.length === 0) {
      return { ok: true, summary: `${toolName}: no issues found`, content: 'No issues found.' };
    }
    const lines = result.content.map((item: Record<string, unknown>, i: number) => {
      const parts = Object.entries(item)
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join(', ');
      return `${i + 1}. ${parts}`;
    });
    return {
      ok: true,
      summary: `${toolName}: ${result.content.length} item(s)`,
      content: lines.join('\n'),
    };
  }

  return { ok: true, summary: toolName, content: String(result.content) };
}

function defineTool(name: string, description: string, parameters: Record<string, unknown>): ToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters,
    },
  };
}

function toolOk(summary: string, content: string): ToolExecutionResult {
  return { ok: true, summary, content };
}

function toolError(summary: string, content: string): ToolExecutionResult {
  return { ok: false, summary, content };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(min, Math.min(max, number));
}

function walkFiles(root: string, start: string): string[] {
  if (!existsSync(start)) return [];
  const stats = statSync(start);
  if (stats.isFile()) return [start];
  if (!stats.isDirectory()) return [];

  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
      const absolute = join(dir, entry.name);
      const rel = relative(root, absolute);
      if (rel.startsWith('..') || isAbsolute(rel)) continue;
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
      }
    }
  };
  visit(start);
  return files;
}

function isTextFile(path: string): boolean {
  const name = path.toLowerCase();
  const index = name.lastIndexOf('.');
  if (index === -1) return true;
  return TEXT_EXTENSIONS.has(name.slice(index));
}

function globMatcher(pattern: string): (path: string) => boolean {
  const normalized = normalizePath(pattern);
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '.*');
  const regex = new RegExp(`^${escaped}$`, 'i');
  return path => regex.test(normalizePath(path));
}

function makeLineMatcher(query: string, regex: boolean, caseSensitive: boolean): (line: string) => boolean {
  if (regex) {
    const flags = caseSensitive ? '' : 'i';
    const pattern = new RegExp(query, flags);
    return line => pattern.test(line);
  }

  const needle = caseSensitive ? query : query.toLowerCase();
  return line => (caseSensitive ? line : line.toLowerCase()).includes(needle);
}

function countOccurrences(text: string, search: string): number {
  if (!search) return 0;
  return text.split(search).length - 1;
}

function createUnifiedDiff(filePath: string, before: string, after: string): string {
  const beforeLines = before ? before.split('\n') : [];
  const afterLines = after ? after.split('\n') : [];
  const lines = [
    `--- ${before ? filePath : '/dev/null'}`,
    `+++ ${filePath}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
  ];
  const edits = diffLines(beforeLines, afterLines);

  for (const edit of edits) {
    lines.push(`${edit.type}${edit.line}`);
  }

  return lines.join('\n');
}

function diffLines(beforeLines: string[], afterLines: string[]): Array<{ type: ' ' | '-' | '+'; line: string }> {
  const rows = beforeLines.length + 1;
  const cols = afterLines.length + 1;
  const table = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = beforeLines.length - 1; i >= 0; i--) {
    for (let j = afterLines.length - 1; j >= 0; j--) {
      table[i][j] = beforeLines[i] === afterLines[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const edits: Array<{ type: ' ' | '-' | '+'; line: string }> = [];
  let i = 0;
  let j = 0;
  while (i < beforeLines.length || j < afterLines.length) {
    if (i < beforeLines.length && j < afterLines.length && beforeLines[i] === afterLines[j]) {
      edits.push({ type: ' ', line: beforeLines[i] });
      i++;
      j++;
    } else if (j < afterLines.length && (i === beforeLines.length || table[i][j + 1] >= table[i + 1][j])) {
      edits.push({ type: '+', line: afterLines[j] });
      j++;
    } else if (i < beforeLines.length) {
      edits.push({ type: '-', line: beforeLines[i] });
      i++;
    }
  }
  return edits;
}

function mergeProviderUsage(current: ProviderUsage | undefined, next: ProviderUsage | undefined): ProviderUsage | undefined {
  if (!next) return current;
  return {
    promptTokens: addUsage(current?.promptTokens, next.promptTokens),
    completionTokens: addUsage(current?.completionTokens, next.completionTokens),
    totalTokens: addUsage(current?.totalTokens, next.totalTokens),
    promptCacheHitTokens: addUsage(current?.promptCacheHitTokens, next.promptCacheHitTokens),
    promptCacheMissTokens: addUsage(current?.promptCacheMissTokens, next.promptCacheMissTokens),
  };
}

function addUsage(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return (a ?? 0) + (b ?? 0);
}

function truncateToolResult(content: string): string {
  if (content.length <= MAX_TOOL_RESULT_CHARS) return content;
  return `${content.slice(0, MAX_TOOL_RESULT_CHARS)}\n... tool result truncated`;
}

function abortResult(): ToolExecutionResult {
  return { ok: false, summary: 'aborted', content: 'Tool execution aborted by user.' };
}

function computeBatchSignature(
  calls: ProviderToolCall[],
  results: Array<{ toolCall: ProviderToolCall; result: ToolExecutionResult }>,
): string | null {
  if (calls.length === 0) return null;
  const resultMap = new Map(results.map(r => [r.toolCall.id, r.result]));
  const allFailed = calls.every(c => !resultMap.get(c.id)?.ok);
  if (!allFailed) return null;
  return calls.map(c => {
    const r = resultMap.get(c.id);
    const errMsg = r?.content.split('\n')[0] ?? '';
    return `${c.function.name}\x00${errMsg}`;
  }).join('\x00');
}

async function maybeCompactMessages(messages: Message[], provider: LLMProvider): Promise<void> {
  const totalChars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  if (totalChars <= COMPACT_THRESHOLD_CHARS) return;
  if (messages.length <= COMPACT_KEEP_RECENT + 2) return;

  const systemMsg = messages[0];
  const recentMessages = messages.slice(-COMPACT_KEEP_RECENT);
  const oldMessages = messages.slice(1, messages.length - COMPACT_KEEP_RECENT);

  const oldText = oldMessages.map(m => {
    const role = m.role === 'tool' ? `tool(${m.name})` : m.role;
    const content = m.content.length > 2000 ? m.content.slice(0, 2000) + '...' : m.content;
    return `[${role}] ${content}`;
  }).join('\n\n');

  try {
    const summary = await provider.chat([
      {
        role: 'system',
        content: '你是一个写作代理的对话压缩器。将旧对话历史压缩为结构化摘要。规则：简洁、要点式。保留文件路径、角色名、设定细节。不要发明不在对话中的内容。',
      },
      {
        role: 'user',
        content: `压缩以下写作代理的对话历史为简洁摘要，使用以下结构：

## 任务
用户的写作需求

## 已完成
已写的文件和修改

## 设定变化
新角色、关系、世界观、时间线

## 风格决策
确定的风格选择

## 待办
未完成的部分

对话历史：
${oldText}`,
      },
    ], { temperature: 0.1, maxTokens: 2048 });

    messages.length = 0;
    messages.push(systemMsg);
    messages.push({ role: 'user', content: `[compaction-summary]\n${summary}\n[/compaction-summary]` });
    messages.push(...recentMessages);
  } catch {
    // Compaction failure is non-fatal; the loop continues with the full history
  }
}

function parseFrontmatter(raw: string): { status?: string; category?: string; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { body: raw };
  const frontmatter = match[1];
  const body = match[2];
  const fields: Record<string, string> = {};
  for (const line of frontmatter.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      fields[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
    }
  }
  return { status: fields.status, category: fields.category, body };
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function trimLine(text: string, maxLength: number): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 3)}...`;
}

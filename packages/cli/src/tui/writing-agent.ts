import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve } from 'path';
import type {
  LLMProvider,
  Message,
  ProjectConfig,
  ProviderToolCall,
  ProviderUsage,
  ToolDefinition,
} from '@openwriter/core';

const MAX_ITERATIONS = 10;
const MAX_TOOL_RESULT_CHARS = 60000;
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

export function isExplicitWriteRequest(input: string): boolean {
  return /(?:^|[\s/])(?:write|edit|revise|rewrite|polish|continue|draft|create|add|remove|fix|change|update|save)\b/i.test(input)
    || /写入|写到|写进|保存|新建|创建|新增|删除|替换|修改|改写|改成|修订|润色|重写|续写|补写|扩写|缩写|调整|整理到|落盘/.test(input);
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

  const runtime = new WritingToolRuntime(options.workDir, options.allowWrites);
  const tools = runtime.tools.map(tool => tool.definition).sort((a, b) => {
    return a.function.name.localeCompare(b.function.name);
  });
  const messages: Message[] = [
    { role: 'system', content: buildSystemPrompt(options.projectConfig) },
    { role: 'user', content: buildUserPrompt(options.task, options.workDir, options.allowWrites, options.modeHint) },
  ];

  let accumulatedUsage: ProviderUsage | undefined;
  let finalContent = '';

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

    for (const toolCall of response.toolCalls) {
      // Check for interruption before each tool execution
      if (signal?.aborted) {
        return {
          content: '[aborted by user] The task was interrupted during tool execution. Partial results may be available.',
          diffs: runtime.diffs,
          usage: accumulatedUsage,
        };
      }

      const result = await runtime.executeToolCall(toolCall, options.callbacks);
      messages.push({
        role: 'tool',
        toolCallId: toolCall.id,
        name: toolCall.function.name,
        content: truncateToolResult(result.content),
      });
    }
  }

  throw new Error(`agent stopped after ${MAX_ITERATIONS} tool iterations without a final answer`);
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
    'Do not route every request to specialists. You are the lead agent. Answer directly unless a file tool is useful.',
    'For check, analyze, explain, summarize, review, or brainstorm requests, use read-only tools and answer in prose. Do not change files.',
    'Only call write_file or edit_file when the user explicitly asks to create, write, revise, polish, update, remove, or otherwise change files.',
    'Never infer a target file from retrieval and overwrite it. Read the exact file first before editing an existing file. If the target is unclear, ask a concise question.',
    'When you change files, make the smallest useful edit and summarize the diff in your final answer.',
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
  readonly diffs: string[] = [];
  readonly tools: AgentTool[];

  constructor(private readonly workDir: string, private readonly allowWrites: boolean) {
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
    this.tools = allowWrites ? [...readOnlyTools, ...writeTools] : readOnlyTools;
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

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function trimLine(text: string, maxLength: number): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 3)}...`;
}

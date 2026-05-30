import React, { useCallback, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { homedir } from 'os';
import { createProvider } from '@openwriter/core';
import { FileSystemConnector } from '@openwriter/connectors';
import type {
  LLMProvider,
  ProjectConfig,
  ProviderConfig,
  ProviderUsage,
} from '@openwriter/core';
import { DirectorySelector } from './DirectorySelector.js';
import { ModelConfig } from './ModelConfig.js';
import type {
  AgentRunRecord,
  AgentRunStatus,
  AgentRunStep,
  ModelRuntimeConfig,
  ProviderId,
  SupportedModel,
  WorkbenchNotice,
} from './types.js';
import { MODEL_PROVIDERS } from './types.js';
import {
  runWritingAgentTurn,
  type ParsedAgentTurn,
} from './writing-agent.js';

const DEFAULT_MAIN_AGENT_MODEL = 'deepseek-chat';

type ScreenMode = 'config' | 'directory' | 'workbench';

interface UserRuntimeConfig {
  activeProvider?: ProviderId;
  providers?: Partial<Record<ProviderId, ModelRuntimeConfig>>;
  lastWorkspace?: string;
}

interface WorkbenchState {
  mode: ScreenMode;
  model: SupportedModel | null;
  apiKey: string | null;
  provider: ProviderId | null;
  baseUrl: string | null;
  modelDisplayName: string | null;
  workDir: string;
  input: string;
  runs: AgentRunRecord[];
  notices: WorkbenchNotice[];
  activeRunId: number | null;
  /** AbortController for the currently running agent turn */
  abortController: AbortController | null;
  projectConfig: ProjectConfig | null;
  sessionUsage: AgentRunRecord['usage'] | null;
}

export function ChatInterface() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const initialModel = detectInitialModel();
  const initialWorkspace = detectInitialWorkspace();
  const [exitArmedAt, setExitArmedAt] = useState<number | null>(null);
  const [state, setState] = useState<WorkbenchState>(() => {
    const workDir = initialWorkspace ?? process.cwd();
    if (workDir !== process.cwd()) process.chdir(workDir);
    const projectConfig = readProjectConfig(workDir);
    return {
      mode: initialModel ? (initialWorkspace ? 'workbench' : 'directory') : 'config',
      model: initialModel?.model ?? null,
      apiKey: initialModel?.apiKey ?? null,
      provider: initialModel?.provider ?? null,
      baseUrl: initialModel?.baseUrl ?? null,
      modelDisplayName: initialModel?.displayName ?? null,
      workDir,
      input: '',
      runs: [],
      notices: initialWorkspace ? [{ tone: 'info', text: `workspace: ${workDir}` }] : [],
      activeRunId: null,
      abortController: null,
      projectConfig,
      sessionUsage: null,
    };
  });

  const terminalWidth = stdout?.columns ?? 100;
  const latestRun = state.runs[state.runs.length - 1];
  const running = state.activeRunId !== null;

  const status = useMemo(() => {
    if (!latestRun) return 'ready';
    if (latestRun.status === 'running') return `running ${latestRun.workflow}`;
    if (latestRun.status === 'failed') return 'failed';
    return `done ${latestRun.workflow}`;
  }, [latestRun]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') exit();
    if (state.mode === 'workbench' && key.escape) {
      // If an agent turn is running, abort it instead of quitting
      if (running && state.abortController) {
        state.abortController.abort();
        pushNotice({ tone: 'warning', text: 'aborting current turn...' });
        return;
      }
      const now = Date.now();
      if (exitArmedAt && now - exitArmedAt < 2000) {
        exit();
        return;
      }
      setExitArmedAt(now);
      pushNotice({ tone: 'warning', text: 'press Esc again to quit' });
    }
  });

  const pushNotice = useCallback((notice: WorkbenchNotice) => {
    setState(prev => ({
      ...prev,
      notices: [...prev.notices.slice(-4), notice],
    }));
  }, []);

  const handleModelConfig = useCallback((config: ModelRuntimeConfig) => {
    applyRuntimeEnv(config);
    saveUserModelConfig(config);
    setState(prev => ({
      ...prev,
      model: config.model,
      apiKey: config.apiKey ?? null,
      provider: config.provider,
      baseUrl: config.baseUrl,
      modelDisplayName: config.displayName,
      mode: prev.projectConfig ? 'workbench' : 'directory',
    }));
  }, []);

  const handleConfigCancel = useCallback(() => {
    setState(prev => ({
      ...prev,
      mode: prev.projectConfig ? 'workbench' : 'directory',
    }));
  }, []);

  const handleDirectorySelect = useCallback((dir: string) => {
    const resolved = resolve(dir);
    process.chdir(resolved);
    saveUserWorkspaceConfig(resolved);
    setState(prev => ({
      ...prev,
      workDir: resolved,
      mode: 'workbench',
      projectConfig: readProjectConfig(resolved),
      notices: [{
        tone: 'info',
        text: `workspace: ${resolved}`,
      }],
    }));
  }, []);

  const handleSubmit = useCallback(async (rawInput: string) => {
    const input = rawInput.trim();
    if (!input || running) return;

    if (handleLocalCommand(input, state, setState, pushNotice, exit)) {
      return;
    }

    const parsed = parseAgentInput(input);
    if (!parsed) {
      pushNotice({
        tone: 'warning',
        text: 'unknown command. Try /write, /check, /brainstorm, /style, /setting, or /help',
      });
      setState(prev => ({ ...prev, input: '' }));
      return;
    }

    await runAgentTurn(parsed, state, setState, pushNotice);
  }, [exit, pushNotice, running, state]);

  if (state.mode === 'config') {
    return (
      <ModelConfig
        onConfig={handleModelConfig}
        onCancel={handleConfigCancel}
        canCancel={Boolean(state.provider && state.model)}
      />
    );
  }

  if (state.mode === 'directory') {
    return <DirectorySelector onSelect={handleDirectorySelect} currentDir={state.workDir} />;
  }

  return (
    <Box flexDirection="column" minHeight={24}>
      <Header
        model={state.modelDisplayName ?? state.model ?? 'not configured'}
        workDir={state.workDir}
        project={state.projectConfig}
      />

      <Box flexDirection={terminalWidth >= 110 ? 'row' : 'column'} flexGrow={1}>
        <Box flexDirection="column" width={terminalWidth >= 110 ? '70%' : '100%'} paddingRight={terminalWidth >= 110 ? 1 : 0}>
          <Conversation runs={state.runs} />
        </Box>

        <Box flexDirection="column" width={terminalWidth >= 110 ? '30%' : '100%'}>
          <SidePanel notices={state.notices} />
        </Box>
      </Box>

      <Footer
        run={latestRun}
        status={status}
        model={state.modelDisplayName ?? state.model ?? 'not configured'}
        running={running}
        sessionUsage={state.sessionUsage}
      />

      <Box borderStyle="single" borderColor={running ? 'yellow' : 'cyan'} paddingX={1}>
        {running ? (
          <Box>
            <Spinner type="dots" />
            <Text color="yellow"> thinking...</Text>
          </Box>
        ) : (
          <Box>
            <Text color="cyan">{'> '}</Text>
            <TextInput
              value={state.input}
              onChange={(value) => {
                setExitArmedAt(null);
                setState(prev => ({ ...prev, input: value }));
              }}
              onSubmit={handleSubmit}
              placeholder="/write next scene | /check continuity | /brainstorm ideas | /help"
              showCursor={false}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}

function Header({ model, workDir, project }: { model: string; workDir: string; project: ProjectConfig | null }) {
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} justifyContent="space-between">
      <Box>
        <Text bold color="cyan">OpenWriter Agent TUI</Text>
        <Text dimColor>  observe - act - verify</Text>
      </Box>
      <Box>
        <Text color="green">{model}</Text>
        <Text dimColor> | {project?.project.name ?? 'no project'} | {shortPath(workDir)}</Text>
      </Box>
    </Box>
  );
}

function Conversation({ runs }: { runs: AgentRunRecord[] }) {
  const visibleRuns = runs.slice(-5);
  if (visibleRuns.length === 0) {
    return (
      <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
        <Text color="cyan">Waiting for a task</Text>
        <Text dimColor>Type naturally. OpenWriter reads the workspace and edits only when you ask.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {visibleRuns.map((run, index) => (
        <ConversationTurn
          key={run.id}
          run={run}
          isLatest={index === visibleRuns.length - 1}
        />
      ))}
    </Box>
  );
}

function ConversationTurn({ run, isLatest }: { run: AgentRunRecord; isLatest: boolean }) {
  const borderColor = run.status === 'failed' ? 'red' : run.status === 'running' ? 'yellow' : 'green';
  const completed = run.steps.filter(step => step.status === 'done').length;
  const activeStep = run.steps.find(step => step.status === 'running');
  const outputLines = run.output ? visibleOutputLines(run.output, run.status, isLatest) : [];
  return (
    <Box borderStyle="round" borderColor={borderColor} paddingX={1} marginBottom={1} flexDirection="column">
      <Box justifyContent="space-between">
        <Text bold color="cyan">{'> '}{run.task}</Text>
        <Text dimColor>{run.durationMs ? `${formatDuration(run.durationMs)}` : 'running'}</Text>
      </Box>
      {run.status === 'running' && (
        <Text color="yellow">
          {'thinking'}{activeStep ? `: ${formatAgentName(activeStep.agent)}` : ''} ({completed}/{run.steps.length})
        </Text>
      )}
      {run.thought && run.status !== 'running' && <Text dimColor>{run.thought}</Text>}
      {outputLines.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          {outputLines.map((line, index) => (
            <Text key={`${run.id}-out-${index}`}>{line || ' '}</Text>
          ))}
        </Box>
      )}
      {run.error && <Text color="red">{run.error}</Text>}
    </Box>
  );
}

function SidePanel({ notices }: { notices: WorkbenchNotice[] }) {
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="blue" paddingX={1} flexDirection="column">
        <Text bold color="blue">Session</Text>
        <Text dimColor>Esc twice quits</Text>
        <Text dimColor>/details shows run internals</Text>
      </Box>

      <Box borderStyle="round" borderColor="gray" paddingX={1} marginTop={1} flexDirection="column">
        <Text bold>Commands</Text>
        <Text dimColor>/init name</Text>
        <Text dimColor>/write task</Text>
        <Text dimColor>/check task</Text>
        <Text dimColor>/brainstorm task</Text>
        <Text dimColor>/style file</Text>
        <Text dimColor>/save path</Text>
        <Text dimColor>/config | /provider id | /model id</Text>
        <Text dimColor>/details | /cd path | /clear</Text>
      </Box>

      {notices.length > 0 && (
        <Box borderStyle="round" borderColor="gray" paddingX={1} marginTop={1} flexDirection="column">
          <Text bold>Events</Text>
          {notices.slice(-5).map((notice, index) => (
            <Text key={`${notice.text}-${index}`} color={noticeColor(notice.tone)}>
              {notice.text}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

function visibleOutputLines(output: string, status: AgentRunStatus, isLatest: boolean): string[] {
  const lines = output.split('\n');
  if (status === 'running') return tailLines(lines, 30);
  if (!isLatest) return headLines(lines, 12);
  if (isDiffPreview(output)) return compactDiffLines(lines, 180);
  return lines;
}

function tailLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines;
  return [
    `... ${lines.length - maxLines} earlier lines`,
    ...lines.slice(-maxLines),
  ];
}

function headLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines;
  return [
    ...lines.slice(0, maxLines),
    `... ${lines.length - maxLines} more lines`,
  ];
}

function compactDiffLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines;
  const headCount = Math.max(20, Math.floor(maxLines * 0.6));
  const tailCount = Math.max(10, maxLines - headCount);
  return [
    ...lines.slice(0, headCount),
    `... ${lines.length - headCount - tailCount} diff lines hidden`,
    ...lines.slice(-tailCount),
  ];
}

function isDiffPreview(output: string): boolean {
  return output.includes('\n--- ') && output.includes('\n+++ ');
}

function Footer({
  run,
  status,
  model,
  running,
  sessionUsage,
}: {
  run?: AgentRunRecord;
  status: string;
  model: string;
  running: boolean;
  sessionUsage: AgentRunRecord['usage'] | null;
}) {
  return (
    <Box paddingX={1} justifyContent="space-between">
      <Box>
        <Text color="cyan">lead-agent</Text>
        <Text dimColor> | {model} | {status}</Text>
      </Box>
      <Box>
        {running && <Text color="yellow">working </Text>}
        <Text color="cyan">{sessionUsage ? formatUsageCache(sessionUsage) : 'cache n/a'}</Text>
        <Text dimColor> | session </Text>
        <Text color="green">{sessionUsage ? formatUsageCost(sessionUsage) : 'cost n/a'}</Text>
      </Box>
    </Box>
  );
}

async function runAgentTurn(
  parsed: ParsedAgentTurn,
  state: WorkbenchState,
  setState: React.Dispatch<React.SetStateAction<WorkbenchState>>,
  pushNotice: (notice: WorkbenchNotice) => void,
) {
  const config = readProjectConfig(state.workDir);
  const runId = Date.now();
  const startedAt = Date.now();
  const run: AgentRunRecord = {
    id: runId,
    workflow: parsed.label,
    task: parsed.task,
    status: 'running',
    startedAt,
    steps: [{
      agent: 'lead-agent',
      description: 'reason about the request and decide whether tools are needed',
      phase: 'think',
      role: 'lead',
      reason: parsed.allowWrites ? 'write tools enabled by explicit user intent' : 'read-only unless the user asks for edits',
      status: 'running',
      startedAt,
    }],
    rationale: [
      parsed.allowWrites
        ? 'File writes can only happen through explicit write/edit tool calls.'
        : 'This turn exposes read-only tools, so checks and analysis cannot edit files.',
    ],
  };

  // Create AbortController for this turn
  const abortController = new AbortController();
  setState(prev => ({
    ...prev,
    input: '',
    activeRunId: runId,
    abortController,
    runs: [...prev.runs, run],
    projectConfig: config,
  }));

  const oldCwd = process.cwd();
  process.chdir(state.workDir);

  try {
    const provider = createConfiguredProvider(state);
    let streamedOutput = '';
    const result = await runWritingAgentTurn({
      provider,
      workDir: state.workDir,
      task: parsed.task,
      allowWrites: parsed.allowWrites,
      modeHint: parsed.modeHint,
      projectConfig: config,
      signal: abortController.signal,
      callbacks: {
        onThought: thought => {
          setState(prev => updateRun(prev, runId, current => ({
            ...current,
            thought,
          })));
        },
        onToolStart: (name, args) => {
          const stepStartedAt = Date.now();
          setState(prev => updateRun(prev, runId, current => ({
            ...current,
            thought: `tool: ${name}`,
            steps: [
              ...completeRunningSteps(current.steps, stepStartedAt),
              {
                agent: `tool:${name}`,
                description: formatToolDescription(name, args),
                phase: 'tool',
                role: 'tool',
                status: 'running',
                startedAt: stepStartedAt,
              },
            ],
          })));
        },
        onToolEnd: (name, toolResult) => {
          const endedAt = Date.now();
          setState(prev => updateRun(prev, runId, current => ({
            ...current,
            steps: completeLatestStep(current.steps, `tool:${name}`, endedAt, {
              summary: toolResult.summary,
              error: toolResult.ok ? undefined : toolResult.content,
            }),
          })));
        },
        onTextDelta: delta => {
          streamedOutput += delta;
          setState(prev => updateRun(prev, runId, current => ({
            ...current,
            output: streamedOutput,
            thought: 'answering...',
          })));
        },
      },
    });

    const output = result.diffs.length
      ? appendDiffPreview(result.content, result.diffs)
      : result.content;
    const runUsage = toRunUsage(result.usage);
    const sessionUsage = runUsage ? mergeUsage(state.sessionUsage, runUsage) : state.sessionUsage;
    setState(prev => updateRun(prev, runId, current => ({
      ...current,
      status: 'done',
      durationMs: Date.now() - startedAt,
      steps: completeRunningSteps(current.steps, Date.now()),
      output,
      usage: runUsage,
      thought: result.diffs.length ? 'edited via file tools' : 'answered',
    }), {
      activeRunId: null,
      abortController: null,
      sessionUsage,
    }));
    pushNotice({
      tone: 'success',
      text: result.diffs.length ? `${parsed.label} edited files` : `${parsed.label} completed`,
    });
  } catch (error) {
    setState(prev => updateRun(prev, runId, current => ({
      ...current,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      error: errorMessage(error),
    }), { activeRunId: null, abortController: null }));
    pushNotice({ tone: 'error', text: errorMessage(error) });
  } finally {
    process.chdir(oldCwd);
  }
}

function createConfiguredProvider(state: WorkbenchState): LLMProvider {
  const providerName = state.provider ?? 'deepseek';
  const provider = createProvider(providerName);
  return withProviderDefaults(provider, {
    apiKey: state.apiKey ?? undefined,
    baseUrl: state.baseUrl ?? (providerName === 'deepseek' ? 'https://api.deepseek.com' : undefined),
    model: state.model ?? DEFAULT_MAIN_AGENT_MODEL,
  });
}

function withProviderDefaults(provider: LLMProvider, defaults: ProviderConfig): LLMProvider {
  return {
    name: provider.name,
    chat: (messages, config) => provider.chat(messages, { ...defaults, ...config }),
    chatJson: (messages, schema, config) => provider.chatJson(messages, schema, { ...defaults, ...config }),
    chatWithTools: provider.chatWithTools
      ? (messages, tools, config) => provider.chatWithTools!(messages, tools, { ...defaults, ...config })
      : undefined,
    getLastUsage: provider.getLastUsage?.bind(provider),
  };
}

function handleLocalCommand(
  input: string,
  state: WorkbenchState,
  setState: React.Dispatch<React.SetStateAction<WorkbenchState>>,
  pushNotice: (notice: WorkbenchNotice) => void,
  exit: () => void,
): boolean {
  if (!input.startsWith('/')) return false;
  const [command, ...rest] = input.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim();

  switch (command) {
    case 'q':
    case 'quit':
    case 'exit':
      exit();
      return true;
    case 'help':
      pushNotice({
        tone: 'info',
        text: '/write /check /brainstorm /style /setting /plan /save /details /config /provider /model /clear /quit',
      });
      setState(prev => ({ ...prev, input: '' }));
      return true;
    case 'config':
    case 'settings':
      setState(prev => ({ ...prev, input: '', mode: 'config' }));
      return true;
    case 'clear':
      setState(prev => ({ ...prev, input: '', runs: [], notices: [], sessionUsage: null }));
      return true;
    case 'details': {
      const latestRun = state.runs.at(-1);
      if (!latestRun) {
        pushNotice({ tone: 'info', text: 'no run yet' });
      } else {
        pushNotice({
          tone: latestRun.status === 'failed' ? 'error' : 'info',
          text: formatRunDetails(latestRun),
        });
      }
      setState(prev => ({ ...prev, input: '' }));
      return true;
    }
    case 'save': {
      const latestRun = state.runs.at(-1);
      if (!arg) {
        pushNotice({ tone: 'warning', text: 'usage: /save <path>' });
      } else if (!latestRun?.output) {
        pushNotice({ tone: 'warning', text: 'nothing to save yet' });
      } else {
        new FileSystemConnector(state.workDir).writeContent(arg, latestRun.output);
        pushNotice({ tone: 'success', text: `saved: ${arg}` });
      }
      setState(prev => ({ ...prev, input: '' }));
      return true;
    }
    case 'provider': {
      const provider = MODEL_PROVIDERS.find(item => item.id === arg || item.provider === arg);
      if (!provider) {
        pushNotice({ tone: 'warning', text: 'available providers: deepseek, custom' });
      } else {
        const saved = loadSavedProviderConfig(provider.provider);
        const apiKey = saved?.apiKey ?? (provider.envKey ? process.env[provider.envKey] : undefined);
        if (provider.apiKeyRequired && !apiKey) {
          pushNotice({ tone: 'warning', text: `run /config to set ${provider.name}` });
          setState(prev => ({ ...prev, input: '' }));
          return true;
        }
        const model = saved?.model ?? provider.models[0]?.id ?? DEFAULT_MAIN_AGENT_MODEL;
        const nextConfig: ModelRuntimeConfig = {
          provider: provider.provider,
          model,
          baseUrl: saved?.baseUrl ?? provider.baseUrl,
          apiKey,
          envKey: provider.envKey,
          displayName: `${provider.name} / ${model}`,
        };
        applyRuntimeEnv(nextConfig);
        saveUserModelConfig(nextConfig);
        setState(prev => ({
          ...prev,
          input: '',
          provider: nextConfig.provider,
          model,
          baseUrl: nextConfig.baseUrl,
          apiKey: apiKey ?? null,
          modelDisplayName: nextConfig.displayName,
        }));
        pushNotice({ tone: 'success', text: `provider set to ${provider.name}` });
      }
      return true;
    }
    case 'model':
      if (!arg) {
        pushNotice({ tone: 'warning', text: 'usage: /model <model-id>' });
      } else {
        const provider = state.provider ?? 'deepseek';
        const nextConfig: ModelRuntimeConfig = {
          provider,
          model: arg,
          baseUrl: state.baseUrl ?? (provider === 'deepseek' ? 'https://api.deepseek.com' : ''),
          apiKey: state.apiKey ?? undefined,
          envKey: provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'OPENAI_API_KEY',
          displayName: `${provider} / ${arg}`,
        };
        saveUserModelConfig(nextConfig);
        setState(prev => ({
          ...prev,
          model: arg,
          modelDisplayName: nextConfig.displayName,
          input: '',
        }));
        pushNotice({ tone: 'success', text: `model switched to ${arg}` });
      }
      return true;
    case 'cd': {
      const target = resolve(state.workDir, arg || '.');
      if (!existsSync(target)) {
        pushNotice({ tone: 'error', text: `directory not found: ${target}` });
      } else {
        process.chdir(target);
        saveUserWorkspaceConfig(target);
        setState(prev => ({
          ...prev,
          input: '',
          workDir: target,
          projectConfig: readProjectConfig(target),
        }));
        pushNotice({ tone: 'success', text: `workspace: ${target}` });
      }
      return true;
    }
    case 'init': {
      const connector = new FileSystemConnector(state.workDir);
      const config = connector.initProject(arg || 'My Writing Project');
      setState(prev => ({ ...prev, input: '', projectConfig: config }));
      pushNotice({ tone: 'success', text: `project initialized: ${config.project.name}` });
      return true;
    }
    default:
      return false;
  }
}

function parseAgentInput(input: string): ParsedAgentTurn | null {
  if (input.startsWith('/')) {
    const [command, ...rest] = input.slice(1).split(/\s+/);
    const task = rest.join(' ').trim();
    switch (command) {
      case 'write':
      case 'w':
        return {
          label: 'write',
          task: task || 'continue writing',
          allowWrites: true,
          modeHint: 'The user explicitly invoked /write. Edit files only through write_file or edit_file, and ask if the target is unclear.',
        };
      case 'check':
        return {
          label: 'check',
          task: task || 'check the project',
          allowWrites: false,
          modeHint: 'Read-only continuity, structure, and consistency check. Do not modify files.',
        };
      case 'brainstorm':
      case 'ideas':
        return {
          label: 'brainstorm',
          task: task || 'brainstorm ideas',
          allowWrites: false,
          modeHint: 'Brainstorm naturally. Save or edit files only if the user explicitly asked for that.',
        };
      case 'style':
      case 'polish':
      case 'revise':
        return {
          label: command === 'style' ? 'style' : command,
          task: task || (command === 'style' ? 'review style' : 'revise text'),
          allowWrites: command !== 'style',
          modeHint: command === 'style'
            ? 'Style review by default. If the user only named a file, read it and give notes instead of editing.'
            : 'The user requested revision/polish. Use edit_file only after reading the target file.',
        };
      case 'setting':
        return {
          label: 'setting',
          task: task || 'work on setting',
          allowWrites: false,
          modeHint: 'Handle setting/worldbuilding in the existing workspace structure. Do not assume any fixed folder layout.',
        };
      case 'plan':
        return {
          label: 'plan',
          task: task || 'plan structure',
          allowWrites: false,
          modeHint: 'Planning is read-only unless the user explicitly asks to write the plan to a file.',
        };
      default:
        return null;
    }
  }

  return {
    label: 'agent',
    task: input,
    allowWrites: false,
  };
}

function updateRun(
  state: WorkbenchState,
  runId: number,
  mutate: (run: AgentRunRecord) => AgentRunRecord,
  extra?: Partial<WorkbenchState>,
): WorkbenchState {
  return {
    ...state,
    ...extra,
    runs: state.runs.map(run => run.id === runId ? mutate(run) : run),
  };
}

function completeRunningSteps(steps: AgentRunStep[], endedAt: number): AgentRunStep[] {
  return steps.map(step => step.status === 'running'
    ? {
      ...step,
      status: 'done',
      durationMs: step.startedAt ? endedAt - step.startedAt : undefined,
    }
    : step);
}

function completeLatestStep(
  steps: AgentRunStep[],
  agent: string,
  endedAt: number,
  details: Pick<AgentRunStep, 'summary' | 'error'>,
): AgentRunStep[] {
  let index = -1;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].agent === agent && steps[i].status === 'running') {
      index = i;
      break;
    }
  }
  if (index === -1) return steps;
  return steps.map((step, stepIndex) => stepIndex === index
    ? {
      ...step,
      status: details.error ? 'failed' : 'done',
      durationMs: step.startedAt ? endedAt - step.startedAt : undefined,
      summary: details.summary,
      error: details.error,
    }
    : step);
}

function formatToolDescription(name: string, args: Record<string, unknown>): string {
  const path = typeof args.path === 'string' ? args.path : undefined;
  const query = typeof args.query === 'string' ? args.query : undefined;
  const pattern = typeof args.pattern === 'string' ? args.pattern : undefined;
  switch (name) {
    case 'read_file':
      return path ? `read ${path}` : 'read file';
    case 'list_dir':
      return path ? `list ${path}` : 'list workspace';
    case 'grep':
      return query ? `grep ${trimLine(query, 40)}` : 'grep files';
    case 'glob':
      return pattern ? `glob ${trimLine(pattern, 40)}` : 'glob files';
    case 'edit_file':
      return path ? `edit ${path}` : 'edit file';
    case 'write_file':
      return path ? `write ${path}` : 'write file';
    default:
      return name;
  }
}

function appendDiffPreview(content: string, diffs: string[]): string {
  const body = content.trim() || 'Updated files.';
  return `${body}\n\n${diffs.join('\n\n')}`;
}

function toRunUsage(usage?: ProviderUsage): AgentRunRecord['usage'] | undefined {
  if (!usage) return undefined;
  const cacheHitTokens = usage.promptCacheHitTokens ?? 0;
  const cacheMissTokens = usage.promptCacheMissTokens ?? 0;
  const cacheInputTokens = cacheHitTokens + cacheMissTokens;
  return {
    cacheHitRate: cacheInputTokens > 0 ? cacheHitTokens / cacheInputTokens : undefined,
    cacheHitTokens,
    cacheMissTokens,
    promptTokens: usage.promptTokens ?? 0,
    completionTokens: usage.completionTokens ?? 0,
  };
}

function formatRunCache(run: AgentRunRecord): string {
  return run.usage ? formatUsageCache(run.usage) : 'cache n/a';
}

function formatRunCost(run: AgentRunRecord): string {
  return run.usage ? formatUsageCost(run.usage) : 'cost n/a';
}

function formatUsageCache(usage: NonNullable<AgentRunRecord['usage']>): string {
  if (usage.cacheHitRate === undefined) return 'cache n/a';
  return `${formatPercent(usage.cacheHitRate)} hit`;
}

function formatUsageCost(usage: NonNullable<AgentRunRecord['usage']>): string {
  if (!usage || usage.estimatedUsd === undefined) return 'cost n/a';
  return formatUsd(usage.estimatedUsd);
}

function mergeUsage(
  current: AgentRunRecord['usage'] | null,
  next: NonNullable<AgentRunRecord['usage']>,
): NonNullable<AgentRunRecord['usage']> {
  if (!current) return next;
  const cacheHitTokens = current.cacheHitTokens + next.cacheHitTokens;
  const cacheMissTokens = current.cacheMissTokens + next.cacheMissTokens;
  const cacheInputTokens = cacheHitTokens + cacheMissTokens;
  return {
    cacheHitTokens,
    cacheMissTokens,
    promptTokens: current.promptTokens + next.promptTokens,
    completionTokens: current.completionTokens + next.completionTokens,
    cacheHitRate: cacheInputTokens > 0 ? cacheHitTokens / cacheInputTokens : undefined,
    estimatedUsd: addOptional(current.estimatedUsd, next.estimatedUsd),
    estimatedSavingsUsd: addOptional(current.estimatedSavingsUsd, next.estimatedSavingsUsd),
  };
}

function addOptional(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return (a ?? 0) + (b ?? 0);
}

function formatAgentName(agent: string): string {
  if (agent === 'lead-agent') return 'thinking';
  if (agent.startsWith('tool:')) return agent.slice('tool:'.length);
  return agent
    .replace('context-retriever', 'reading workspace')
    .replace('prose-writer', 'writing')
    .replace('continuity-checker', 'checking continuity')
    .replace('style-editor', 'polishing')
    .replace('plot-architect', 'planning')
    .replace('worldbuilding-agent', 'checking setting');
}

function formatRunDetails(run: AgentRunRecord): string {
  const steps = run.steps.map(step => `${step.agent}:${step.status}`).join(', ');
  return `${run.workflow} ${run.status}; ${steps}; ${formatRunCache(run)}; ${formatRunCost(run)}`;
}

function readProjectConfig(workDir: string): ProjectConfig | null {
  return new FileSystemConnector(workDir).readConfig();
}

function detectInitialWorkspace(): string | null {
  const cwd = process.cwd();
  if (readProjectConfig(cwd)) return cwd;

  const saved = readUserRuntimeConfig().lastWorkspace;
  if (!saved) return null;

  const resolved = resolve(saved);
  return existsSync(resolved) ? resolved : null;
}

function detectInitialModel(): ModelRuntimeConfig | null {
  const userConfig = readUserRuntimeConfig();
  const activeProvider = userConfig.activeProvider;
  if (activeProvider) {
    const saved = userConfig.providers?.[activeProvider];
    if (saved?.apiKey) {
      applyRuntimeEnv(saved);
      return saved;
    }
  }

  for (const provider of MODEL_PROVIDERS) {
    if (provider.custom || !provider.envKey) continue;
    const apiKey = process.env[provider.envKey];
    if (!apiKey) continue;
    const model = provider.models[0]?.id ?? DEFAULT_MAIN_AGENT_MODEL;

    return {
      provider: provider.provider,
      model,
      baseUrl: provider.baseUrl,
      apiKey,
      envKey: provider.envKey,
      displayName: `${provider.name} / ${model}`,
    };
  }
  return null;
}

function loadSavedProviderConfig(provider: ProviderId): ModelRuntimeConfig | undefined {
  return readUserRuntimeConfig().providers?.[provider];
}

function saveUserModelConfig(config: ModelRuntimeConfig): void {
  const current = readUserRuntimeConfig();
  const next: UserRuntimeConfig = {
    ...current,
    activeProvider: config.provider,
    providers: {
      ...(current.providers ?? {}),
      [config.provider]: config,
    },
  };
  const path = userConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
}

function saveUserWorkspaceConfig(workDir: string): void {
  const current = readUserRuntimeConfig();
  const next: UserRuntimeConfig = {
    ...current,
    lastWorkspace: resolve(workDir),
  };
  const path = userConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
}

function readUserRuntimeConfig(): UserRuntimeConfig {
  const path = userConfigPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as UserRuntimeConfig;
  } catch {
    return {};
  }
}

function userConfigPath(): string {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? homedir(), 'OpenWriter', 'config.json');
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'openwriter', 'config.json');
}

function applyRuntimeEnv(config: ModelRuntimeConfig): void {
  if (config.envKey && config.apiKey) {
    process.env[config.envKey] = config.apiKey;
  }
}

function noticeColor(tone: WorkbenchNotice['tone']): 'cyan' | 'green' | 'yellow' | 'red' {
  switch (tone) {
    case 'success':
      return 'green';
    case 'warning':
      return 'yellow';
    case 'error':
      return 'red';
    default:
      return 'cyan';
  }
}

function trimLine(text: string, maxLength: number): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 3)}...`;
}

function shortPath(path: string): string {
  if (path.length <= 46) return path;
  return `...${path.slice(-43)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatUsd(value: number): string {
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}

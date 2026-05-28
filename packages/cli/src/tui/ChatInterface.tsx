import React, { useCallback, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
  createProvider,
  Orchestrator,
  planAgentLoop,
  summarizeUsageCosts,
} from '@openwriter/core';
import {
  CharacterAgent,
  ContextRetriever,
  ContinuityChecker,
  Critic,
  MemoryCurator,
  PatchAgent,
  PlotArchitect,
  ProseWriter,
  StyleEditor,
  WorldbuildingAgent,
} from '@openwriter/agents';
import { FileSystemConnector } from '@openwriter/connectors';
import type {
  AgentLoopPlan,
  AgentResult,
  CacheSnapshot,
  LLMProvider,
  ProjectConfig,
  ProviderConfig,
  StyleProfile,
  UsageCostEstimate,
  UsageCostSummary,
  WorkflowName,
  WritingContextPacket,
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

const DEFAULT_MAIN_AGENT_MODEL = 'deepseek-chat';
const DEFAULT_SUBAGENT_MODEL = 'deepseek-v4-flash';

const AGENT_MODEL_CONFIG_KEYS: Record<string, string> = {
  'context-retriever': 'retriever',
  'plot-architect': 'plot_architect',
  'character-agent': 'character_agent',
  'worldbuilding-agent': 'worldbuilding_agent',
  'prose-writer': 'prose_writer',
  'continuity-checker': 'continuity_checker',
  'style-editor': 'style_editor',
  critic: 'critic',
  'memory-curator': 'memory_curator',
  'patch-agent': 'patch_agent',
};

const AGENT_DESCRIPTIONS: Record<string, string> = {
  'context-retriever': 'load relevant canon, drafts, and cache-stable context',
  'plot-architect': 'reason about plot structure, causality, pacing, and setup',
  'character-agent': 'check motivation, relationships, and character arcs',
  'worldbuilding-agent': 'check setting rules and world consistency',
  'prose-writer': 'draft prose as the lead writer',
  'continuity-checker': 'verify canon, timeline, and contradiction risks',
  'style-editor': 'review voice, prose style, repetition, and AI-like phrasing',
  critic: 'broad review across structure, character, pacing, setting, and prose',
  'memory-curator': 'summarize memory/canon changes',
  'patch-agent': 'prepare file patch output',
};

type ScreenMode = 'config' | 'directory' | 'workbench';

interface ParsedWorkflow {
  workflow: WorkflowName;
  task: string;
  label: string;
  extraContent?: string;
  targetFile?: string;
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
  projectConfig: ProjectConfig | null;
}

export function ChatInterface() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const initialModel = detectInitialModel();
  const [state, setState] = useState<WorkbenchState>(() => ({
    mode: initialModel ? 'directory' : 'config',
    model: initialModel?.model ?? null,
    apiKey: initialModel?.apiKey ?? null,
    provider: initialModel?.provider ?? null,
    baseUrl: initialModel?.baseUrl ?? null,
    modelDisplayName: initialModel?.displayName ?? null,
    workDir: process.cwd(),
    input: '',
    runs: [],
    notices: [],
    activeRunId: null,
    projectConfig: readProjectConfig(process.cwd()),
  }));

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
    if (state.mode === 'workbench' && key.escape) exit();
  });

  const pushNotice = useCallback((notice: WorkbenchNotice) => {
    setState(prev => ({
      ...prev,
      notices: [...prev.notices.slice(-4), notice],
    }));
  }, []);

  const handleModelConfig = useCallback((config: ModelRuntimeConfig) => {
    if (config.envKey && config.apiKey) {
      process.env[config.envKey] = config.apiKey;
    }
    setState(prev => ({
      ...prev,
      model: config.model,
      apiKey: config.apiKey ?? null,
      provider: config.provider,
      baseUrl: config.baseUrl,
      modelDisplayName: config.displayName,
      mode: 'directory',
    }));
  }, []);

  const handleDirectorySelect = useCallback((dir: string) => {
    const resolved = resolve(dir);
    process.chdir(resolved);
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

    const parsed = parseWorkflowInput(input, state.workDir);
    if (!parsed) {
      pushNotice({
        tone: 'warning',
        text: 'unknown command. Try /write, /check, /brainstorm, /style, /setting, or /help',
      });
      setState(prev => ({ ...prev, input: '' }));
      return;
    }

    await runWorkflow(parsed, state, setState, pushNotice);
  }, [exit, pushNotice, running, state]);

  if (state.mode === 'config') {
    return <ModelConfig onConfig={handleModelConfig} />;
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
          <RunTimeline runs={state.runs} />
        </Box>

        <Box flexDirection="column" width={terminalWidth >= 110 ? '30%' : '100%'}>
          <SidePanel run={latestRun} notices={state.notices} />
        </Box>
      </Box>

      <Footer
        run={latestRun}
        status={status}
        model={state.modelDisplayName ?? state.model ?? 'not configured'}
        running={running}
      />

      <Box borderStyle="single" borderColor={running ? 'yellow' : 'cyan'} paddingX={1}>
        {running ? (
          <Box>
            <Spinner type="dots" />
            <Text color="yellow"> agent loop is running...</Text>
          </Box>
        ) : (
          <TextInput
            value={state.input}
            onChange={(value) => setState(prev => ({ ...prev, input: value }))}
            onSubmit={handleSubmit}
            placeholder="/write next scene | /check continuity | /brainstorm ideas | /help"
          />
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

function RunTimeline({ runs }: { runs: AgentRunRecord[] }) {
  const visibleRuns = runs.slice(-5);
  if (visibleRuns.length === 0) {
    return (
      <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
        <Text color="cyan">Waiting for a task</Text>
        <Text dimColor>The loop will choose only the agents needed for this turn.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {visibleRuns.map(run => (
        <RunCard key={run.id} run={run} />
      ))}
    </Box>
  );
}

function RunCard({ run }: { run: AgentRunRecord }) {
  const borderColor = run.status === 'failed' ? 'red' : run.status === 'running' ? 'yellow' : 'green';
  return (
    <Box borderStyle="round" borderColor={borderColor} paddingX={1} marginBottom={1} flexDirection="column">
      <Box justifyContent="space-between">
        <Text bold color={borderColor}>{statusGlyph(run.status)} {run.workflow}</Text>
        <Text dimColor>{run.durationMs ? `${formatDuration(run.durationMs)}` : 'running'}</Text>
      </Box>
      <Text>{run.task}</Text>
      {run.rationale?.length ? (
        <Box marginTop={1} flexDirection="column">
          <Text color="cyan">loop plan</Text>
          {run.rationale.slice(0, 4).map((line, index) => (
            <Text key={`${run.id}-reason-${index}`} dimColor>{line}</Text>
          ))}
        </Box>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        {run.steps.map(step => <AgentStepRow key={step.agent} step={step} />)}
      </Box>
      {run.output && (
        <Box marginTop={1} flexDirection="column">
          <Text color="cyan">result</Text>
          {run.output.split('\n').slice(0, 10).map((line, index) => (
            <Text key={`${run.id}-out-${index}`}>{line || ' '}</Text>
          ))}
        </Box>
      )}
      {run.error && <Text color="red">{run.error}</Text>}
    </Box>
  );
}

function AgentStepRow({ step }: { step: AgentRunStep }) {
  const color = step.status === 'failed'
    ? 'red'
    : step.status === 'running'
      ? 'yellow'
      : step.status === 'done'
        ? 'green'
        : 'gray';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={color}>{statusGlyph(step.status)} </Text>
        {step.phase && <Text color="magenta">{step.phase} </Text>}
        <Text bold>{step.agent}</Text>
        <Text dimColor> - {step.description}</Text>
        {step.durationMs !== undefined && <Text dimColor> {formatDuration(step.durationMs)}</Text>}
      </Box>
      {(step.reason || step.summary || step.cacheLabel || step.costLabel || step.error) && (
        <Box marginLeft={2} flexDirection="column">
          {step.reason && <Text dimColor>{step.reason}</Text>}
          {step.summary && <Text>{step.summary}</Text>}
          <Box>
            {step.cacheLabel && <Text color="cyan">{step.cacheLabel}</Text>}
            {step.cacheLabel && step.costLabel && <Text dimColor> | </Text>}
            {step.costLabel && <Text color="green">{step.costLabel}</Text>}
          </Box>
          {step.error && <Text color="red">{step.error}</Text>}
        </Box>
      )}
    </Box>
  );
}

function SidePanel({ run, notices }: { run?: AgentRunRecord; notices: WorkbenchNotice[] }) {
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="blue" paddingX={1} flexDirection="column">
        <Text bold color="blue">Session</Text>
        {run ? (
          <>
            <Text>workflow: {run.workflow}</Text>
            <Text>status: {run.status}</Text>
            <Text>agents: {run.steps.filter(s => s.status === 'done').length}/{run.steps.length}</Text>
            <Text>cache: {formatRunCache(run)}</Text>
            <Text>cost: {formatRunCost(run)}</Text>
            {run.skippedAgents?.length ? (
              <Text dimColor>skipped: {run.skippedAgents.slice(0, 4).join(', ')}</Text>
            ) : null}
          </>
        ) : (
          <Text dimColor>no run yet</Text>
        )}
      </Box>

      <Box borderStyle="round" borderColor="gray" paddingX={1} marginTop={1} flexDirection="column">
        <Text bold>Commands</Text>
        <Text dimColor>/init name</Text>
        <Text dimColor>/write task</Text>
        <Text dimColor>/check task</Text>
        <Text dimColor>/brainstorm task</Text>
        <Text dimColor>/style file</Text>
        <Text dimColor>/save path</Text>
        <Text dimColor>/provider id | /model id</Text>
        <Text dimColor>/cd path | /clear</Text>
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

function Footer({
  run,
  status,
  model,
  running,
}: {
  run?: AgentRunRecord;
  status: string;
  model: string;
  running: boolean;
}) {
  return (
    <Box paddingX={1} justifyContent="space-between">
      <Box>
        <Text color="cyan">agent-loop</Text>
        <Text dimColor> | {model} | {status}</Text>
      </Box>
      <Box>
        {running && <Text color="yellow">working </Text>}
        <Text color="cyan">{run ? formatRunCache(run) : 'cache n/a'}</Text>
        <Text dimColor> | </Text>
        <Text color="green">{run ? formatRunCost(run) : 'cost n/a'}</Text>
      </Box>
    </Box>
  );
}

async function runWorkflow(
  parsed: ParsedWorkflow,
  state: WorkbenchState,
  setState: React.Dispatch<React.SetStateAction<WorkbenchState>>,
  pushNotice: (notice: WorkbenchNotice) => void,
) {
  const config = readProjectConfig(state.workDir);
  if (!config) {
    pushNotice({ tone: 'error', text: 'openwriter.yaml not found. Run /init <project-name> first.' });
    setState(prev => ({ ...prev, input: '' }));
    return;
  }

  const context = buildContextPacket(config, parsed.task, parsed.extraContent);
  const plan = planAgentLoop(parsed.workflow, context);
  const runId = Date.now();
  const startedAt = Date.now();
  const run: AgentRunRecord = {
    id: runId,
    workflow: plan.label,
    task: parsed.task,
    status: 'running',
    startedAt,
    steps: createInitialSteps(plan),
    rationale: plan.rationale,
    skippedAgents: plan.skippedAgents,
  };

  setState(prev => ({
    ...prev,
    input: '',
    activeRunId: runId,
    runs: [...prev.runs, run],
    projectConfig: config,
  }));

  const oldCwd = process.cwd();
  process.chdir(state.workDir);

  try {
    const provider = createConfiguredProvider(state);
    const orchestrator = createWritingOrchestrator(provider);
    const mainModel = state.model ?? config.models?.main_agent ?? DEFAULT_MAIN_AGENT_MODEL;
    const agentModels = resolveAgentModels(plan.steps, config, mainModel);

    const results = await orchestrator.executeCustomPipeline(plan.steps, context, {
      model: mainModel,
      agentModels,
      apiKey: state.apiKey ?? undefined,
      baseUrl: state.baseUrl ?? undefined,
      quiet: true,
      observer: {
        onAgentStart: event => {
          setState(prev => updateRun(prev, runId, current => ({
            ...current,
            steps: current.steps.map(step => step.agent === event.agent
              ? { ...step, status: 'running', startedAt: Date.now() }
              : step),
          })));
        },
        onAgentComplete: event => {
          const estimate = event.result
            ? summarizeUsageCosts({ [event.agent]: event.result }, agentModels[event.agent] ?? mainModel).estimates[0]
            : undefined;
          setState(prev => updateRun(prev, runId, current => ({
            ...current,
            steps: current.steps.map(step => step.agent === event.agent
              ? {
                ...step,
                status: 'done',
                durationMs: event.durationMs,
                summary: event.result ? summarizeAgentResult(event.result) : undefined,
                cacheLabel: formatCacheSnapshot(getCacheSnapshot(event.result)),
                costLabel: estimate ? formatEstimate(estimate) : undefined,
              }
              : step),
          })));
        },
        onAgentError: event => {
          setState(prev => updateRun(prev, runId, current => ({
            ...current,
            status: 'failed',
            error: errorMessage(event.error),
            steps: current.steps.map(step => step.agent === event.agent
              ? {
                ...step,
                status: 'failed',
                durationMs: event.durationMs,
                error: errorMessage(event.error),
              }
              : step),
          })));
        },
      },
    });

    const workflowOutput = buildWorkflowOutput(parsed.workflow, results);
    const persistedOutput = persistWorkflowOutput(parsed, state.workDir, workflowOutput);
    const usage = summarizeUsageCosts(results, mainModel);
    setState(prev => updateRun(prev, runId, current => ({
      ...current,
      status: 'done',
      durationMs: Date.now() - startedAt,
      output: persistedOutput ?? workflowOutput,
      usage: toRunUsage(usage),
    }), { activeRunId: null }));
    pushNotice({
      tone: 'success',
      text: persistedOutput ? `${parsed.label} wrote ${parsed.targetFile}` : `${parsed.label} completed`,
    });
  } catch (error) {
    setState(prev => updateRun(prev, runId, current => ({
      ...current,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      error: errorMessage(error),
    }), { activeRunId: null }));
    pushNotice({ tone: 'error', text: errorMessage(error) });
  } finally {
    process.chdir(oldCwd);
  }
}

function createWritingOrchestrator(provider: LLMProvider): Orchestrator {
  const orchestrator = new Orchestrator();
  orchestrator.register(new ContextRetriever());
  orchestrator.register(new ProseWriter(provider));
  orchestrator.register(new ContinuityChecker(provider));
  orchestrator.register(new Critic(provider));
  orchestrator.register(new MemoryCurator(provider));
  orchestrator.register(new CharacterAgent(provider));
  orchestrator.register(new PlotArchitect(provider));
  orchestrator.register(new WorldbuildingAgent(provider));
  orchestrator.register(new StyleEditor(provider));
  orchestrator.register(new PatchAgent());
  return orchestrator;
}

function resolveAgentModels(
  steps: AgentLoopPlan['steps'],
  config: ProjectConfig,
  mainModel: string,
): Record<string, string> {
  const modelConfig = config.models ?? {};
  const subagentDefault = modelConfig.subagent_default ?? DEFAULT_SUBAGENT_MODEL;
  return Object.fromEntries(steps.map(step => {
    const key = AGENT_MODEL_CONFIG_KEYS[step.agent] ?? step.agent.replace(/-/g, '_');
    const configured = modelConfig[key] ?? modelConfig[step.agent];
    const model = configured ?? (step.role === 'lead' ? mainModel : subagentDefault);
    return [step.agent, model];
  }));
}

function createConfiguredProvider(state: WorkbenchState): LLMProvider {
  const provider = createProvider('deepseek');
  return withProviderDefaults(provider, {
    apiKey: state.apiKey ?? undefined,
    baseUrl: state.baseUrl ?? 'https://api.deepseek.com',
    model: state.model ?? DEFAULT_MAIN_AGENT_MODEL,
  });
}

function withProviderDefaults(provider: LLMProvider, defaults: ProviderConfig): LLMProvider {
  return {
    name: provider.name,
    chat: (messages, config) => provider.chat(messages, { ...defaults, ...config }),
    chatJson: (messages, schema, config) => provider.chatJson(messages, schema, { ...defaults, ...config }),
    getLastUsage: provider.getLastUsage?.bind(provider),
  };
}

function buildContextPacket(
  config: ProjectConfig,
  task: string,
  extraContent?: string,
): WritingContextPacket {
  return {
    task,
    projectProfile: {
      name: config.project.name,
      language: config.project.language,
      genre: config.project.genre,
      sourceOfTruth: config.project.sourceOfTruth,
      draftDirs: config.project.draftDirs,
      style: config.style as StyleProfile,
      memory: config.memory,
      retrieval: config.retrieval,
      cache: config.cache,
    },
    relevantCanon: [],
    relevantDrafts: extraContent ? [{ source: 'input', content: extraContent }] : [],
    deprecatedItems: [],
    openQuestions: [],
    constraints: [
      config.writing.allowNewCanonWithoutConfirmation ? '' : 'Do not introduce major canon without confirmation.',
      config.writing.allowMajorPlotChangeWithoutConfirmation ? '' : 'Do not change the core plot direction without confirmation.',
    ].filter(Boolean),
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
        text: '/write /check /brainstorm /style /setting /plan /save /init /cd /provider /model /clear /quit',
      });
      setState(prev => ({ ...prev, input: '' }));
      return true;
    case 'clear':
      setState(prev => ({ ...prev, input: '', runs: [], notices: [] }));
      return true;
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
      if (!provider || provider.custom) {
        pushNotice({ tone: 'warning', text: 'only provider supported: deepseek' });
      } else {
        const model = provider.models[0]?.id ?? state.model ?? DEFAULT_MAIN_AGENT_MODEL;
        setState(prev => ({
          ...prev,
          input: '',
          provider: provider.provider,
          model,
          baseUrl: provider.baseUrl,
          apiKey: provider.envKey ? process.env[provider.envKey] ?? prev.apiKey : null,
          modelDisplayName: `${provider.name} / ${model}`,
        }));
        pushNotice({ tone: 'success', text: `provider set to ${provider.name}` });
      }
      return true;
    }
    case 'model':
      if (!arg) {
        pushNotice({ tone: 'warning', text: 'usage: /model <model-id>' });
      } else {
        setState(prev => ({
          ...prev,
          model: arg,
          modelDisplayName: `${prev.provider ?? 'provider'} / ${arg}`,
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

function parseWorkflowInput(input: string, workDir: string): ParsedWorkflow | null {
  if (input.startsWith('/')) {
    const [command, ...rest] = input.slice(1).split(/\s+/);
    const task = rest.join(' ').trim();
    switch (command) {
      case 'write':
      case 'w':
        return parseTargetedCommand('chapterWriting', task, workDir, 'write', 'continue writing');
      case 'check':
        return { workflow: 'continuityCheck', task: task || 'check project continuity', label: 'check' };
      case 'brainstorm':
      case 'ideas':
        return { workflow: 'brainstorm', task: task || 'brainstorm plot or setting ideas', label: 'brainstorm' };
      case 'style':
      case 'polish':
      case 'revise':
        return parsePolishCommand(command, task, workDir);
      case 'setting':
        return { workflow: 'setting', task: task || 'expand setting', label: 'setting' };
      case 'plan':
        return parseTargetedCommand('chapterWriting', task, workDir, 'plan', 'plan chapter structure');
      default:
        return null;
    }
  }

  return { workflow: 'chapterWriting', task: input, label: 'write' };
}

function parsePolishCommand(command: string, task: string, workDir: string): ParsedWorkflow {
  const parsed = parseTargetedCommand('polish', task, workDir, command === 'style' ? 'style' : 'polish', 'polish text');
  return {
    ...parsed,
    task: parsed.task || (command === 'style' ? 'review style' : 'polish text'),
  };
}

function parseTargetedCommand(
  workflow: WorkflowName,
  task: string,
  workDir: string,
  label: string,
  defaultTask: string,
): ParsedWorkflow {
  const [maybeFile, ...rest] = task.split(/\s+/);
  const targetFile = maybeFile && looksLikeTextFile(maybeFile) ? maybeFile : undefined;
  if (!targetFile) {
    return { workflow, task: task || defaultTask, label };
  }

  const filePath = resolve(workDir, targetFile);
  const extraContent = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : undefined;
  const goal = rest.join(' ').trim();
  return {
    workflow,
    task: goal || defaultTask,
    label,
    extraContent,
    targetFile,
  };
}

function looksLikeTextFile(path: string): boolean {
  return /\.(md|markdown|txt|text|rst|adoc)$/i.test(path);
}

function createInitialSteps(plan: AgentLoopPlan): AgentRunStep[] {
  return plan.steps.map(step => ({
    agent: step.agent,
    description: AGENT_DESCRIPTIONS[step.agent] ?? 'run agent',
    phase: step.phase,
    role: step.role,
    reason: step.reason,
    status: 'queued',
  }));
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

function summarizeAgentResult(result: AgentResult): string {
  if (typeof result.content === 'string') return trimLine(result.content, 160);

  const content = result.content as Record<string, unknown>;
  if (content.packet && content.summary) {
    return `context ready: ${trimLine(JSON.stringify(content.summary), 140)}`;
  }
  if (Array.isArray(result.content)) {
    return `${result.content.length} items`;
  }
  return trimLine(JSON.stringify(result.content), 160);
}

function buildWorkflowOutput(workflow: WorkflowName, results: Record<string, AgentResult>): string {
  const preferred = workflow === 'chapterWriting'
    ? results['prose-writer']
    : workflow === 'polish'
      ? results['style-editor'] ?? results['continuity-checker']
      : results.critic ?? Object.values(results).at(-1);

  if (!preferred) return 'workflow completed';
  if (typeof preferred.content === 'string') return preferred.content;
  return JSON.stringify(preferred.content, null, 2);
}

function persistWorkflowOutput(parsed: ParsedWorkflow, workDir: string, output: string): string | null {
  if (!parsed.targetFile) return null;

  const connector = new FileSystemConnector(workDir);
  const targetPath = resolve(workDir, parsed.targetFile);
  const before = existsSync(targetPath) ? readFileSync(targetPath, 'utf-8') : '';
  connector.writeContent(parsed.targetFile, output);
  const diff = createUnifiedDiff(parsed.targetFile, before, output);
  return `wrote ${parsed.targetFile}\n\n${diff}`;
}

function createUnifiedDiff(filePath: string, before: string, after: string): string {
  const beforeLines = before ? before.split('\n') : [];
  const afterLines = after ? after.split('\n') : [];
  const max = Math.max(beforeLines.length, afterLines.length);
  const lines = [
    `--- ${before ? filePath : '/dev/null'}`,
    `+++ ${filePath}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
  ];

  for (let index = 0; index < max; index++) {
    const oldLine = beforeLines[index];
    const newLine = afterLines[index];
    if (oldLine === newLine && oldLine !== undefined) {
      lines.push(` ${oldLine}`);
    } else {
      if (oldLine !== undefined) lines.push(`-${oldLine}`);
      if (newLine !== undefined) lines.push(`+${newLine}`);
    }
  }

  return lines.join('\n');
}

function getCacheSnapshot(result?: AgentResult): CacheSnapshot | undefined {
  const cache = result?.metadata?.cache;
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) return undefined;
  return cache as CacheSnapshot;
}

function formatCacheSnapshot(cache?: CacheSnapshot): string | undefined {
  if (!cache) return undefined;
  return `cache prefix ${cache.immutablePrefixHash.slice(0, 8)} | ctx ~${cache.approxContextTokens} tok`;
}

function formatEstimate(estimate: UsageCostEstimate): string {
  const hit = estimate.cacheHitRate === undefined ? 'n/a' : formatPercent(estimate.cacheHitRate);
  const cost = estimate.estimatedUsd === undefined ? 'cost n/a' : formatUsd(estimate.estimatedUsd);
  return `cache ${hit} | ${cost}`;
}

function toRunUsage(summary: UsageCostSummary): AgentRunRecord['usage'] {
  return {
    cacheHitRate: summary.cacheHitRate,
    cacheHitTokens: summary.cacheHitTokens,
    cacheMissTokens: summary.cacheMissTokens,
    promptTokens: summary.promptTokens,
    completionTokens: summary.completionTokens,
    estimatedUsd: summary.estimatedUsd,
    estimatedSavingsUsd: summary.estimatedSavingsUsd,
  };
}

function formatRunCache(run: AgentRunRecord): string {
  const usage = run.usage;
  if (!usage || usage.cacheHitRate === undefined) return 'cache n/a';
  return `${formatPercent(usage.cacheHitRate)} hit (${formatInteger(usage.cacheHitTokens)}/${formatInteger(usage.cacheMissTokens)})`;
}

function formatRunCost(run: AgentRunRecord): string {
  const usage = run.usage;
  if (!usage || usage.estimatedUsd === undefined) return 'cost n/a';
  const saved = usage.estimatedSavingsUsd ? ` saved ${formatUsd(usage.estimatedSavingsUsd)}` : '';
  return `${formatUsd(usage.estimatedUsd)}${saved}`;
}

function readProjectConfig(workDir: string): ProjectConfig | null {
  return new FileSystemConnector(workDir).readConfig();
}

function detectInitialModel(): ModelRuntimeConfig | null {
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

function statusGlyph(status: AgentRunStatus): string {
  switch (status) {
    case 'queued':
      return '.';
    case 'running':
      return '*';
    case 'done':
      return '+';
    case 'failed':
      return 'x';
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

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatUsd(value: number): string {
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}

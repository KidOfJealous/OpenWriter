// Writing Context Packet — the core data structure shared by all subagents
// Every agent receives the same context packet but produces different outputs.

export type MemoryState = 'idea' | 'candidate' | 'canon' | 'deprecated';

export interface CanonEntry {
  source: string;
  status: MemoryState;
  content: string;
  tags?: string[];
}

export interface DraftEntry {
  source: string;
  content: string;
  lastModified?: string;
}

export interface DeprecatedEntry {
  source: string;
  old: string;
  replacement?: string;
  reason?: string;
}

export interface ProjectProfile {
  name: string;
  language: string;
  genre: string;
  sourceOfTruth: string[];
  draftDirs: string[];
  style?: StyleProfile;
  memory?: MemoryConfig;
  retrieval?: RetrievalConfig;
  cache?: Partial<AggressiveCachePolicy>;
}

export interface StyleProfile {
  proseProfile?: string;
  descriptionDensity?: 'low' | 'medium' | 'high';
  dialogueStyle?: string;
  pov?: string;
  taboo?: string[];
}

export interface MemoryConfig {
  canonStates: MemoryState[];
  requireConfirmationForCanon: boolean;
}

export interface RetrievalConfig {
  exactMatchWeight: number;
  vectorWeight: number;
  recencyWeight: number;
  deprecatedPenalty: number;
}

export interface WritingContextPacket {
  task: string;
  projectProfile: ProjectProfile;
  relevantCanon: CanonEntry[];
  relevantDrafts: DraftEntry[];
  deprecatedItems: DeprecatedEntry[];
  openQuestions: string[];
  constraints: string[];
  workflowLog?: WorkflowLogEntry[];
  cache?: CacheSnapshot;
}

export interface AggressiveCachePolicy {
  enabled: boolean;
  strategy: 'conservative' | 'aggressive';
  stablePrefix: boolean;
  appendOnlyWorkflowLog: boolean;
  maxCanonEntries: number;
  maxDraftEntries: number;
  maxCanonEntryChars: number;
  maxDraftEntryChars: number;
  maxWorkflowLogEntries: number;
  maxResultChars: number;
  maxTotalContextChars: number;
}

export interface WorkflowLogEntry {
  index: number;
  agent: string;
  type: AgentResultType;
  content: string;
  contentHash: string;
}

export interface CacheSnapshot {
  strategy: AggressiveCachePolicy['strategy'];
  immutablePrefixHash: string;
  immutablePrefixChars: number;
  workflowLogChars: number;
  approxContextTokens: number;
  trimmed: {
    canonEntries: number;
    draftEntries: number;
    workflowLogEntries: number;
  };
}

// Agent interface

export type AgentResultType = 'text' | 'json' | 'diff';

export interface AgentResult {
  type: AgentResultType;
  content: string | object;
  metadata?: Record<string, unknown>;
}

export interface AgentOptions {
  model?: string;
  agentModels?: Record<string, string>;
  temperature?: number;
  maxTokens?: number;
  quiet?: boolean;
  observer?: WorkflowObserver;
  [key: string]: unknown;
}

export interface WorkflowAgentEvent {
  agent: string;
  index: number;
  total: number;
  context?: WritingContextPacket;
  result?: AgentResult;
  durationMs?: number;
  error?: unknown;
}

export interface WorkflowObserver {
  onAgentStart?: (event: WorkflowAgentEvent) => void;
  onAgentComplete?: (event: WorkflowAgentEvent) => void;
  onAgentError?: (event: WorkflowAgentEvent) => void;
}

export interface WritingAgent {
  name: string;
  description: string;
  execute(context: WritingContextPacket, options?: AgentOptions): Promise<AgentResult>;
}

// Workflow

export interface WorkflowStep {
  agent: string;
  dependsOn?: string[];
  inputTransform?: (prev: Record<string, AgentResult>) => WritingContextPacket;
}

export type WorkflowName = 'brainstorm' | 'setting' | 'chapterWriting' | 'polish' | 'continuityCheck';

export type AgentLoopPhase = 'observe' | 'plan' | 'act' | 'verify' | 'summarize';

export type AgentLoopRole = 'lead' | 'specialist' | 'reviewer' | 'memory';

export interface AgentLoopStep extends WorkflowStep {
  phase: AgentLoopPhase;
  role: AgentLoopRole;
  reason: string;
}

export interface AgentLoopPlan {
  workflow: WorkflowName;
  task: string;
  label: string;
  steps: AgentLoopStep[];
  rationale: string[];
  skippedAgents: string[];
}

export interface AgentLoopPlanningOptions {
  reviewers?: string[];
}

// LLM Provider

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ProviderUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
}

export interface ModelPricing {
  provider: string;
  model: string;
  currency: 'USD';
  inputCacheHitUsdPerMillion: number;
  inputCacheMissUsdPerMillion: number;
  outputUsdPerMillion: number;
}

export interface UsageCostEstimate {
  agent: string;
  model: string;
  usage: ProviderUsage;
  pricing?: ModelPricing;
  promptTokens: number;
  completionTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  cacheHitRate?: number;
  estimatedUsd?: number;
  uncachedEstimatedUsd?: number;
  estimatedSavingsUsd?: number;
}

export interface UsageCostSummary {
  estimates: UsageCostEstimate[];
  promptTokens: number;
  completionTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  cacheHitRate?: number;
  estimatedUsd?: number;
  uncachedEstimatedUsd?: number;
  estimatedSavingsUsd?: number;
}

export interface LLMProvider {
  name: string;
  chat(messages: Message[], config?: ProviderConfig): Promise<string>;
  chatJson<T>(messages: Message[], schema: object, config?: ProviderConfig): Promise<T>;
  getLastUsage?(): ProviderUsage | undefined;
}

// Project config (parsed from YAML)

export interface ProjectConfig {
  project: {
    name: string;
    language: string;
    genre: string;
    sourceOfTruth: string[];
    draftDirs: string[];
  };
  writing: {
    defaultMode: string;
    allowNewCanonWithoutConfirmation: boolean;
    allowMajorPlotChangeWithoutConfirmation: boolean;
  };
  style: {
    proseProfile: string;
    descriptionDensity: string;
    dialogueStyle: string;
    pov: string;
    taboo: string[];
  };
  memory: {
    canonStates: MemoryState[];
    requireConfirmationForCanon: boolean;
  };
  retrieval: {
    exactMatchWeight: number;
    vectorWeight: number;
    recencyWeight: number;
    deprecatedPenalty: number;
  };
  cache?: Partial<AggressiveCachePolicy>;
  models: Record<string, string>;
}

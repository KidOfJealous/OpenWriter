// Writing Context Packet — the core data structure shared by all agents

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
  sourceOfTruth?: string[];
  draftDirs?: string[];
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
  cache?: CacheSnapshot;
}

export interface AggressiveCachePolicy {
  enabled: boolean;
  strategy: 'conservative' | 'aggressive';
  stablePrefix: boolean;
  maxCanonEntries: number;
  maxDraftEntries: number;
  maxCanonEntryChars: number;
  maxDraftEntryChars: number;
  maxTotalContextChars: number;
}

export interface CacheSnapshot {
  strategy: AggressiveCachePolicy['strategy'];
  immutablePrefixHash: string;
  immutablePrefixChars: number;
  approxContextTokens: number;
  trimmed: {
    canonEntries: number;
    draftEntries: number;
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
  onTextDelta?: (delta: string) => void;
  quiet?: boolean;
  [key: string]: unknown;
}

export interface WritingAgent {
  name: string;
  description: string;
  execute(context: WritingContextPacket, options?: AgentOptions): Promise<AgentResult>;
}

// LLM Provider

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  name?: string;
  toolCalls?: ProviderToolCall[];
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  onToken?: (token: string) => void;
}

export interface ProviderUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ProviderToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
  parsedArguments: Record<string, unknown>;
}

export interface ToolChatResponse {
  content: string;
  toolCalls: ProviderToolCall[];
  usage?: ProviderUsage;
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
  chatWithTools?(messages: Message[], tools: ToolDefinition[], config?: ProviderConfig): Promise<ToolChatResponse>;
  getLastUsage?(): ProviderUsage | undefined;
}

// Project config (parsed from YAML)

export interface ProjectConfig {
  project: {
    name: string;
    language: string;
    genre: string;
    sourceOfTruth?: string[];
    draftDirs?: string[];
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

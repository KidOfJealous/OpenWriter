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
  temperature?: number;
  maxTokens?: number;
  [key: string]: unknown;
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

export interface LLMProvider {
  name: string;
  chat(messages: Message[], config?: ProviderConfig): Promise<string>;
  chatJson<T>(messages: Message[], schema: object, config?: ProviderConfig): Promise<T>;
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
  models: Record<string, string>;
}

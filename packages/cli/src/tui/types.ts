export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  streaming?: boolean;
  metadata?: {
    toolName?: string;
    tokens?: number;
    cost?: number;
  };
}

export interface ChatState {
  mode: 'config' | 'directory' | 'chat' | 'executing';
  messages: ChatMessage[];
  input: string;
  currentTask: string | null;
  model: string | null;
  apiKey: string | null;
  workDir: string;
  projectConfig: { name: string; path: string } | null;
}

export type AgentRunStatus = 'queued' | 'running' | 'done' | 'failed';

export interface AgentRunStep {
  agent: string;
  description: string;
  phase?: string;
  role?: string;
  reason?: string;
  status: AgentRunStatus;
  startedAt?: number;
  durationMs?: number;
  summary?: string;
  cacheLabel?: string;
  costLabel?: string;
  error?: string;
}

export interface AgentRunRecord {
  id: number;
  workflow: string;
  task: string;
  status: AgentRunStatus;
  startedAt: number;
  durationMs?: number;
  steps: AgentRunStep[];
  rationale?: string[];
  skippedAgents?: string[];
  output?: string;
  error?: string;
  usage?: {
    cacheHitRate?: number;
    cacheHitTokens: number;
    cacheMissTokens: number;
    promptTokens: number;
    completionTokens: number;
    estimatedUsd?: number;
    estimatedSavingsUsd?: number;
  };
  thought?: string;
}

export interface WorkbenchNotice {
  tone: 'info' | 'success' | 'warning' | 'error';
  text: string;
}

export type ProviderId = 'deepseek' | 'openai-compatible';

export type SupportedModel = string;

export interface ProviderModel {
  id: string;
  name: string;
  description?: string;
}

export interface ModelProviderPreset {
  id: string;
  name: string;
  provider: ProviderId;
  baseUrl: string;
  envKey?: string;
  apiKeyRequired: boolean;
  description: string;
  models: ProviderModel[];
  custom?: boolean;
}

export interface ModelRuntimeConfig {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  apiKey?: string;
  envKey?: string;
  displayName: string;
}

export const MODEL_PROVIDERS: ModelProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    envKey: 'DEEPSEEK_API_KEY',
    apiKeyRequired: true,
    description: 'Fixed endpoint: https://api.deepseek.com',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', description: 'default writing turns' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', description: 'heavier reasoning turns' },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', description: 'fast subagent/default utility turns' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', description: 'higher quality writing turns' },
    ],
  },
  {
    id: 'custom',
    name: 'Custom',
    provider: 'openai-compatible',
    baseUrl: '',
    envKey: 'OPENAI_API_KEY',
    apiKeyRequired: true,
    description: 'Custom OpenAI-compatible /v1/chat/completions endpoint.',
    models: [
      { id: 'custom', name: 'Custom model id' },
    ],
    custom: true,
  },
];

export const MODEL_CONFIGS: Record<string, {
  name: string;
  envKey?: string;
  baseUrl: string;
}> = Object.fromEntries(
  MODEL_PROVIDERS.flatMap(provider => provider.models.map(model => [
    model.id,
    {
      name: model.name,
      envKey: provider.envKey,
      baseUrl: provider.baseUrl,
    },
  ])),
);

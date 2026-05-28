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
}

export interface WorkbenchNotice {
  tone: 'info' | 'success' | 'warning' | 'error';
  text: string;
}

export type ProviderId = 'deepseek' | 'openai' | 'openai-compatible' | 'ollama';

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
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    provider: 'openai',
    baseUrl: 'https://api.openai.com',
    envKey: 'OPENAI_API_KEY',
    apiKeyRequired: true,
    description: 'Fixed endpoint: https://api.openai.com',
    models: [
      { id: 'gpt-5.2', name: 'GPT-5.2', description: 'frontier agent model' },
      { id: 'gpt-5.1', name: 'GPT-5.1', description: 'frontier agent model' },
      { id: 'gpt-5', name: 'GPT-5', description: 'reasoning model' },
      { id: 'gpt-5-mini', name: 'GPT-5 Mini', description: 'faster GPT-5' },
      { id: 'gpt-5-nano', name: 'GPT-5 Nano', description: 'cheapest GPT-5' },
      { id: 'gpt-4.1', name: 'GPT-4.1', description: 'non-reasoning flagship' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', description: 'smaller GPT-4.1' },
      { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', description: 'fastest GPT-4.1' },
      { id: 'gpt-4o', name: 'GPT-4o', description: 'general purpose' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'fast and cheaper' },
      { id: 'o3', name: 'o3', description: 'reasoning model' },
      { id: 'o4-mini', name: 'o4-mini', description: 'fast reasoning model' },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama Local',
    provider: 'ollama',
    baseUrl: 'http://localhost:11434',
    apiKeyRequired: false,
    description: 'Fixed endpoint: http://localhost:11434',
    models: [
      { id: 'qwen2.5', name: 'Qwen 2.5' },
      { id: 'llama3.1', name: 'Llama 3.1' },
      { id: 'mistral', name: 'Mistral' },
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

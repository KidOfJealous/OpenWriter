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

export type SupportedModel = 'deepseek-chat' | 'deepseek-reasoner' | 'gpt-4o' | 'gpt-4o-mini';

export const MODEL_CONFIGS: Record<SupportedModel, { 
  name: string; 
  envKey: string;
  baseUrl: string;
}> = {
  'deepseek-chat': {
    name: 'DeepSeek Chat',
    envKey: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com',
  },
  'deepseek-reasoner': {
    name: 'DeepSeek Reasoner (R1)',
    envKey: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com',
  },
  'gpt-4o': {
    name: 'GPT-4o',
    envKey: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com',
  },
  'gpt-4o-mini': {
    name: 'GPT-4o Mini',
    envKey: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com',
  },
};
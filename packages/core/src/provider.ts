import type { LLMProvider, Message, ProviderConfig, ProviderUsage } from './types.js';

type ChatCompletionUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
};

export class DeepSeekProvider implements LLMProvider {
  name = 'deepseek';
  private lastUsage?: ProviderUsage;

  async chat(messages: Message[], config?: ProviderConfig): Promise<string> {
    const apiKey = config?.apiKey ?? process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not set');

    const baseUrl = config?.baseUrl ?? 'https://api.deepseek.com';
    const model = config?.model ?? 'deepseek-chat';

    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature: config?.temperature ?? 0.7,
        max_tokens: config?.maxTokens ?? 4096,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DeepSeek API error ${res.status}: ${text}`);
    }

    const data = await res.json() as {
      choices: [{ message: { content: string } }];
      usage?: ChatCompletionUsage;
    };
    this.lastUsage = normalizeUsage(data.usage);
    return data.choices[0].message.content;
  }

  async chatJson<T>(messages: Message[], _schema: object, config?: ProviderConfig): Promise<T> {
    const systemMsg = messages.find(m => m.role === 'system');
    const jsonPrompt: Message[] = [
      ...(systemMsg ? [systemMsg] : []),
      {
        role: 'user',
        content: messages.filter(m => m.role !== 'system').map(m => m.content).join('\n') +
          '\n\n请只返回 JSON，不要额外解释。',
      },
    ];
    const text = await this.chat(jsonPrompt, { ...config, temperature: 0.3 });
    try {
      return JSON.parse(text) as T;
    } catch {
      // Try to extract JSON from markdown code blocks
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) return JSON.parse(match[1].trim()) as T;
      throw new Error(`Failed to parse JSON from: ${text.slice(0, 200)}`);
    }
  }

  getLastUsage(): ProviderUsage | undefined {
    return this.lastUsage;
  }
}

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  private lastUsage?: ProviderUsage;

  async chat(messages: Message[], config?: ProviderConfig): Promise<string> {
    const apiKey = config?.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

    const baseUrl = config?.baseUrl ?? 'https://api.openai.com';
    const model = config?.model ?? 'gpt-4o';

    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature: config?.temperature ?? 0.7,
        max_tokens: config?.maxTokens ?? 4096,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${text}`);
    }

    const data = await res.json() as {
      choices: [{ message: { content: string } }];
      usage?: ChatCompletionUsage;
    };
    this.lastUsage = normalizeUsage(data.usage);
    return data.choices[0].message.content;
  }

  async chatJson<T>(messages: Message[], _schema: object, config?: ProviderConfig): Promise<T> {
    const text = await this.chat(messages, { ...config, temperature: 0.3 });
    try {
      return JSON.parse(text) as T;
    } catch {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) return JSON.parse(match[1].trim()) as T;
      throw new Error(`Failed to parse JSON from: ${text.slice(0, 200)}`);
    }
  }

  getLastUsage(): ProviderUsage | undefined {
    return this.lastUsage;
  }
}

export class OllamaProvider implements LLMProvider {
  name = 'ollama';

  async chat(messages: Message[], config?: ProviderConfig): Promise<string> {
    const baseUrl = config?.baseUrl ?? 'http://localhost:11434';
    const model = config?.model ?? 'qwen2.5';

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: false,
        options: {
          temperature: config?.temperature ?? 0.7,
          num_predict: config?.maxTokens ?? 4096,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama API error ${res.status}: ${text}`);
    }

    const data = await res.json() as { message: { content: string } };
    return data.message.content;
  }

  async chatJson<T>(messages: Message[], _schema: object, config?: ProviderConfig): Promise<T> {
    const text = await this.chat(messages, { ...config, temperature: 0.3 });
    try {
      return JSON.parse(text) as T;
    } catch {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) return JSON.parse(match[1].trim()) as T;
      throw new Error(`Failed to parse JSON from: ${text.slice(0, 200)}`);
    }
  }
}

function normalizeUsage(usage?: ChatCompletionUsage): ProviderUsage | undefined {
  if (!usage) return undefined;
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    promptCacheHitTokens: usage.prompt_cache_hit_tokens,
    promptCacheMissTokens: usage.prompt_cache_miss_tokens,
  };
}

export function createProvider(name: string, config?: Partial<ProviderConfig>): LLMProvider {
  switch (name.toLowerCase()) {
    case 'deepseek':
      return new DeepSeekProvider();
    case 'openai':
      return new OpenAIProvider();
    case 'ollama':
      return new OllamaProvider();
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}

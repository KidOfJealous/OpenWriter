import type {
  LLMProvider,
  Message,
  ProviderConfig,
  ProviderToolCall,
  ProviderUsage,
  ToolChatResponse,
  ToolDefinition,
} from './types.js';

type ChatCompletionUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
};

type ChatCompletionToolCall = {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type ChatCompletionResponse = {
  choices: Array<{
    message?: {
      content?: string | null;
      tool_calls?: ChatCompletionToolCall[];
    };
  }>;
  usage?: ChatCompletionUsage;
};

export class DeepSeekProvider implements LLMProvider {
  name = 'deepseek';
  private lastUsage?: ProviderUsage;

  async chat(messages: Message[], config?: ProviderConfig): Promise<string> {
    const apiKey = config?.apiKey ?? process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not set');

    const baseUrl = config?.baseUrl ?? 'https://api.deepseek.com';
    const model = config?.model ?? 'deepseek-chat';
    const endpoint = `${baseUrl}/v1/chat/completions`;
    const body = {
      model,
      messages: toChatCompletionMessages(messages),
      temperature: config?.temperature ?? 0.7,
      max_tokens: config?.maxTokens ?? 4096,
    };

    if (config?.onToken) {
      return this.chatStream(endpoint, apiKey, body, config.onToken, 'DeepSeek');
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DeepSeek API error ${res.status}: ${text}`);
    }

    const data = await res.json() as ChatCompletionResponse;
    this.lastUsage = normalizeUsage(data.usage);
    return data.choices[0]?.message?.content ?? '';
  }

  async chatWithTools(
    messages: Message[],
    tools: ToolDefinition[],
    config?: ProviderConfig,
  ): Promise<ToolChatResponse> {
    const apiKey = config?.apiKey ?? process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not set');

    const baseUrl = config?.baseUrl ?? 'https://api.deepseek.com';
    const model = config?.model ?? 'deepseek-chat';
    const endpoint = `${baseUrl}/v1/chat/completions`;
    const body = {
      model,
      messages: toChatCompletionMessages(messages),
      tools,
      tool_choice: 'auto',
      temperature: config?.temperature ?? 0.3,
      max_tokens: config?.maxTokens ?? 4096,
    };

    const data = await postChatCompletionJson(endpoint, apiKey, body, 'DeepSeek');
    const usage = normalizeUsage(data.usage);
    this.lastUsage = usage;
    return {
      content: data.choices[0]?.message?.content ?? '',
      toolCalls: normalizeToolCalls(data.choices[0]?.message?.tool_calls),
      usage,
    };
  }

  private async chatStream(
    endpoint: string,
    apiKey: string,
    body: Record<string, unknown>,
    onToken: (token: string) => void,
    label: string,
  ): Promise<string> {
    const res = await fetchChatCompletionStream(endpoint, apiKey, body, label);
    const result = await readChatCompletionStream(res.body, onToken);
    this.lastUsage = normalizeUsage(result.usage);
    return result.content;
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

    const baseUrl = normalizeOpenAIBaseUrl(config?.baseUrl ?? 'https://api.openai.com');
    const model = config?.model ?? 'gpt-4o';
    const endpoint = `${baseUrl}/v1/chat/completions`;
    const body = {
      model,
      messages: toChatCompletionMessages(messages),
      temperature: config?.temperature ?? 0.7,
      max_tokens: config?.maxTokens ?? 4096,
    };

    if (config?.onToken) {
      return this.chatStream(endpoint, apiKey, body, config.onToken);
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI API error ${res.status} at ${endpoint}: ${text || res.statusText}`);
    }

    const data = await res.json() as ChatCompletionResponse;
    this.lastUsage = normalizeUsage(data.usage);
    return data.choices[0]?.message?.content ?? '';
  }

  async chatWithTools(
    messages: Message[],
    tools: ToolDefinition[],
    config?: ProviderConfig,
  ): Promise<ToolChatResponse> {
    const apiKey = config?.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

    const baseUrl = normalizeOpenAIBaseUrl(config?.baseUrl ?? 'https://api.openai.com');
    const model = config?.model ?? 'gpt-4o';
    const endpoint = `${baseUrl}/v1/chat/completions`;
    const body = {
      model,
      messages: toChatCompletionMessages(messages),
      tools,
      tool_choice: 'auto',
      temperature: config?.temperature ?? 0.3,
      max_tokens: config?.maxTokens ?? 4096,
    };

    const data = await postChatCompletionJson(endpoint, apiKey, body, 'OpenAI');
    const usage = normalizeUsage(data.usage);
    this.lastUsage = usage;
    return {
      content: data.choices[0]?.message?.content ?? '',
      toolCalls: normalizeToolCalls(data.choices[0]?.message?.tool_calls),
      usage,
    };
  }

  private async chatStream(
    endpoint: string,
    apiKey: string,
    body: Record<string, unknown>,
    onToken: (token: string) => void,
  ): Promise<string> {
    const res = await fetchChatCompletionStream(endpoint, apiKey, body, 'OpenAI');
    const result = await readChatCompletionStream(res.body, onToken);
    this.lastUsage = normalizeUsage(result.usage);
    return result.content;
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

function toChatCompletionMessages(messages: Message[]): Array<Record<string, unknown>> {
  return messages.map(message => {
    const payload: Record<string, unknown> = {
      role: message.role,
      content: message.content,
    };

    if (message.role === 'assistant' && message.toolCalls?.length) {
      payload.tool_calls = message.toolCalls.map(toolCall => ({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        },
      }));
    }

    if (message.role === 'tool') {
      payload.tool_call_id = message.toolCallId;
      if (message.name) payload.name = message.name;
    }

    return payload;
  });
}

function normalizeToolCalls(toolCalls?: ChatCompletionToolCall[]): ProviderToolCall[] {
  if (!toolCalls?.length) return [];

  return toolCalls.flatMap((toolCall, index) => {
    const name = toolCall.function?.name;
    if (!name) return [];

    const rawArguments = toolCall.function?.arguments ?? '{}';
    return [{
      id: toolCall.id ?? `call_${index}`,
      type: 'function',
      function: {
        name,
        arguments: rawArguments,
      },
      parsedArguments: parseToolArguments(rawArguments),
    } satisfies ProviderToolCall];
  });
}

function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function postChatCompletionJson(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  label: string,
): Promise<ChatCompletionResponse> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${label} API error ${res.status} at ${endpoint}: ${text || res.statusText}`);
  }

  return await res.json() as ChatCompletionResponse;
}

async function fetchChatCompletionStream(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  label: string,
): Promise<Response & { body: ReadableStream<Uint8Array> }> {
  const withUsage = await postChatCompletionStream(endpoint, apiKey, {
    ...body,
    stream: true,
    stream_options: { include_usage: true },
  });
  if (withUsage.ok && withUsage.body) return withUsage as Response & { body: ReadableStream<Uint8Array> };

  const text = await withUsage.text();
  if (withUsage.status === 400 && /stream_options|include_usage/i.test(text)) {
    const retry = await postChatCompletionStream(endpoint, apiKey, {
      ...body,
      stream: true,
    });
    if (retry.ok && retry.body) return retry as Response & { body: ReadableStream<Uint8Array> };

    const retryText = await retry.text();
    throw new Error(`${label} API error ${retry.status} at ${endpoint}: ${retryText || retry.statusText}`);
  }

  throw new Error(`${label} API error ${withUsage.status} at ${endpoint}: ${text || withUsage.statusText}`);
}

function postChatCompletionStream(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

async function readChatCompletionStream(
  body: ReadableStream<Uint8Array>,
  onToken: (token: string) => void,
): Promise<{ content: string; usage?: ChatCompletionUsage }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let usage: ChatCompletionUsage | undefined;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      const parsed = parseStreamPayload(payload);
      if (!parsed) continue;
      if (parsed.usage) usage = parsed.usage;

      const delta = parsed.choices?.[0]?.delta?.content
        ?? parsed.choices?.[0]?.message?.content
        ?? '';
      if (delta) {
        content += delta;
        onToken(delta);
      }
    }
  }

  if (buffer.trim()) {
    const trimmed = buffer.trim();
    const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
    if (payload && payload !== '[DONE]') {
      const parsed = parseStreamPayload(payload);
      if (parsed?.usage) usage = parsed.usage;
      const delta = parsed?.choices?.[0]?.delta?.content
        ?? parsed?.choices?.[0]?.message?.content
        ?? '';
      if (delta) {
        content += delta;
        onToken(delta);
      }
    }
  }

  return { content, usage };
}

function parseStreamPayload(payload: string): {
  choices?: Array<{
    delta?: { content?: string };
    message?: { content?: string };
  }>;
  usage?: ChatCompletionUsage;
} | null {
  try {
    return JSON.parse(payload) as {
      choices?: Array<{
        delta?: { content?: string };
        message?: { content?: string };
      }>;
      usage?: ChatCompletionUsage;
    };
  } catch {
    return null;
  }
}

function normalizeOpenAIBaseUrl(baseUrl: string): string {
  return baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1\/chat\/completions$/i, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/v1$/i, '');
}

export function createProvider(name: string, config?: Partial<ProviderConfig>): LLMProvider {
  switch (name.toLowerCase()) {
    case 'deepseek':
      return new DeepSeekProvider();
    case 'openai':
    case 'openai-compatible':
      return new OpenAIProvider();
    case 'ollama':
      return new OllamaProvider();
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}

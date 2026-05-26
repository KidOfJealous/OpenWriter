/**
 * Provider Manager - LLM 提供者管理
 * 
 * 负责与不同 LLM 提供者通信:
 * - DeepSeek (chat, reasoner)
 * - OpenAI (gpt-4o, gpt-4o-mini)
 */

import type { SupportedModel } from './types.js';
import { MODEL_CONFIGS } from './types.js';

export interface ChatRequest {
  messages: Array<{ role: string; content: string }>;
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  systemPrompt?: string;
}

export interface ChatResponse {
  content: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
}

export class ProviderManager {
  private model: SupportedModel;
  private apiKey: string;
  private baseUrl: string;

  constructor(model: SupportedModel, apiKey: string) {
    this.model = model;
    this.apiKey = apiKey;
    this.baseUrl = MODEL_CONFIGS[model].baseUrl;
  }

  /**
   * 发送聊天请求
   * 
   * 核心功能:
   * - 发送消息历史 + Tool 定义给 LLM
   * - 流式输出响应
   * - 解析 Tool Call
   */
  async chat(
    request: ChatRequest,
    onStream: (chunk: string) => void
  ): Promise<ChatResponse> {
    // 构建请求体
    const body = this.buildRequestBody(request);

    // 发送请求
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API 错误: ${response.status} - ${error}`);
    }

    // 处理流式响应
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法获取响应流');
    }

    let fullContent = '';
    let toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

      for (const line of lines) {
        if (line === 'data: [DONE]') continue;

        try {
          const data = JSON.parse(line.slice(6));
          const delta = data.choices?.[0]?.delta;

          if (delta?.content) {
            fullContent += delta.content;
            onStream(delta.content);
          }

          // 解析 Tool Call (function calling)
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.function?.name) {
                toolCalls.push({
                  name: tc.function.name,
                  args: tc.function.arguments 
                    ? JSON.parse(tc.function.arguments) 
                    : {},
                });
              }
            }
          }
        } catch {
          // 忽略解析错误
        }
      }
    }

    return {
      content: fullContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  /**
   * 构建请求体
   */
  private buildRequestBody(request: ChatRequest): Record<string, unknown> {
    const messages = [];

    // 系统提示
    if (request.systemPrompt) {
      messages.push({
        role: 'system',
        content: request.systemPrompt,
      });
    }

    // 消息历史
    for (const msg of request.messages) {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: true,
    };

    // 添加 Tool 定义 (Function Calling)
    if (request.tools && request.tools.length > 0) {
      body.functions = request.tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
      // 或者使用 tools 格式 (OpenAI 新格式)
      body.tools = request.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    return body;
  }
}
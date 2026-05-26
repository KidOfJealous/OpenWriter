/**
 * QueryEngine - Agent 核心对话引擎
 * 
 * 实现 ReAct 循环:
 * 用户输入 → LLM推理 → Tool调用 → 执行 → 观察结果 → 继续推理
 */

import type { ChatMessage, SupportedModel } from './types.js';
import { TOOLS, type Tool, type ToolCall, type ToolResult } from './tools.js';
import { ProviderManager, type ChatRequest } from './provider.js';

export interface QueryEngineConfig {
  model: SupportedModel;
  apiKey: string;
  tools: Tool[];
  maxIterations: number;
  systemPrompt: string;
}

export class QueryEngine {
  private config: QueryEngineConfig;
  private provider: ProviderManager;
  private messages: ChatMessage[] = [];
  private iterationCount = 0;

  constructor(config: QueryEngineConfig) {
    this.config = config;
    this.provider = new ProviderManager(config.model, config.apiKey);
  }

  /**
   * ReAct 循环入口
   * 处理用户输入，循环执行直到任务完成
   */
  async process(
    userInput: string,
    onStream: (chunk: string) => void,
    onToolCall: (tool: string, args: Record<string, unknown>) => void,
    onToolResult: (tool: string, result: unknown) => void,
    onComplete: () => void
  ): Promise<string> {
    // 添加用户消息
    this.messages.push({
      role: 'user',
      content: userInput,
      timestamp: Date.now(),
    });

    this.iterationCount = 0;
    let finalResponse = '';

    // ReAct 循环
    while (this.iterationCount < this.config.maxIterations) {
      this.iterationCount++;

      // 构建请求
      const request = this.buildRequest();

      // 调用 LLM
      const response = await this.provider.chat(request, onStream);

      // 处理响应
      if (response.toolCalls && response.toolCalls.length > 0) {
        // LLM 决定调用工具
        for (const toolCall of response.toolCalls) {
          onToolCall(toolCall.name, toolCall.args);
          
          // 执行工具
          const result = await this.executeTool(toolCall);
          onToolResult(toolCall.name, result.content);

          // 将工具结果加入消息历史
          this.messages.push({
            role: 'tool',
            content: typeof result.content === 'string' 
              ? result.content 
              : JSON.stringify(result.content),
            timestamp: Date.now(),
            metadata: { toolName: toolCall.name },
          });
        }

        // 继续循环，让 LLM 根据工具结果继续推理
        continue;
      }

      // LLM 产出最终回答，结束循环
      finalResponse = response.content;
      this.messages.push({
        role: 'assistant',
        content: finalResponse,
        timestamp: Date.now(),
      });
      break;
    }

    onComplete();
    return finalResponse;
  }

  /**
   * 构建发送给 LLM 的请求
   */
  private buildRequest(): ChatRequest {
    // 构建消息历史
    const messages = this.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    // 构建 Tool 定义（供 LLM 选择调用）
    const tools = this.config.tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    return {
      messages,
      tools,
      systemPrompt: this.config.systemPrompt,
    };
  }

  /**
   * 执行工具调用
   */
  private async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    const tool = TOOLS.find(t => t.name === toolCall.name);
    if (!tool) {
      return {
        success: false,
        content: `未知工具: ${toolCall.name}`,
      };
    }

    try {
      const result = await tool.execute(toolCall.args);
      return {
        success: true,
        content: result,
      };
    } catch (err) {
      return {
        success: false,
        content: `工具执行错误: ${err instanceof Error ? err.message : '未知错误'}`,
      };
    }
  }

  /**
   * 获取消息历史
   */
  getHistory(): ChatMessage[] {
    return this.messages;
  }

  /**
   * 清空历史
   */
  clearHistory(): void {
    this.messages = [];
    this.iterationCount = 0;
  }
}
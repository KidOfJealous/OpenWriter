import type {
  AgentOptions,
  AgentResult,
  LLMProvider,
  WritingAgent,
  WritingContextPacket,
} from '@openwriter/core';
import { DeepSeekProvider } from '@openwriter/core';
import {
  formatDraftContext,
  formatStableCanonPrefix,
  formatStableProjectPrefix,
  formatWorkflowLog,
} from './prompt-cache.js';

export class ProseWriter implements WritingAgent {
  name = 'prose-writer';
  description = 'Write manuscript prose from project context without casually changing canon.';

  private provider: LLMProvider;

  constructor(provider?: LLMProvider) {
    this.provider = provider ?? new DeepSeekProvider();
  }

  async execute(context: WritingContextPacket, options?: AgentOptions): Promise<AgentResult> {
    const content = await this.provider.chat(
      [
        { role: 'system', content: this.buildSystemPrompt(context) },
        { role: 'user', content: this.buildUserPrompt(context) },
      ],
      {
        model: options?.model,
        temperature: options?.temperature ?? 0.8,
        maxTokens: options?.maxTokens,
        onToken: options?.onTextDelta,
      },
    );

    return {
      type: 'text',
      content,
      metadata: {
        model: options?.model ?? 'deepseek-chat',
        temperature: options?.temperature ?? 0.8,
        providerUsage: this.provider.getLastUsage?.(),
      },
    };
  }

  private buildSystemPrompt(context: WritingContextPacket): string {
    return [
      'You are OpenWriter, a careful long-form fiction writing agent.',
      'Write the actual manuscript text requested by the user.',
      formatStableProjectPrefix(context),
      formatStableCanonPrefix(context),
      formatWorkflowLog(context),
    ].filter(Boolean).join('\n\n');
  }

  private buildUserPrompt(context: WritingContextPacket): string {
    return [
      formatDraftContext(context),
      '# Task',
      context.task,
    ].filter(Boolean).join('\n\n');
  }
}

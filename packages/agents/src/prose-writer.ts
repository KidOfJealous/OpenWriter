import type {
  WritingAgent,
  WritingContextPacket,
  AgentResult,
  AgentOptions,
  LLMProvider,
} from '@openwriter/core';
import { DeepSeekProvider } from '@openwriter/core';
import { formatWorkflowLog } from './prompt-cache.js';

export class ProseWriter implements WritingAgent {
  name = 'prose-writer';
  description = '根据上下文包写正文，不自行新增重大设定';

  private provider: LLMProvider;

  constructor(provider?: LLMProvider) {
    this.provider = provider ?? new DeepSeekProvider();
  }

  async execute(context: WritingContextPacket, options?: AgentOptions): Promise<AgentResult> {
    const systemPrompt = this.buildSystemPrompt(context);
    const userPrompt = this.buildUserPrompt(context);

    const content = await this.provider.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        model: options?.model,
        temperature: options?.temperature ?? 0.8,
        maxTokens: options?.maxTokens,
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
    const style = context.projectProfile.style;
    const styleRules = [
      '你是一位专业的主笔，负责根据上下文撰写正文。',
      '严格遵守以下规则：',
      '- 不得自行新增重大设定',
      '- 不得自行改变时间线或人物关系',
      '- 不得自行发明关键设定',
      style?.proseProfile ? `- 文风要求：${style.proseProfile}` : '',
      style?.dialogueStyle ? `- 对白风格：${style.dialogueStyle}` : '',
      style?.taboo?.length ? `- 禁忌：${style.taboo.join('、')}` : '',
    ].filter(Boolean).join('\n');

    const canonContext = context.relevantCanon
      .map(e => `【${e.source}】(${e.status})\n${e.content.slice(0, 500)}`)
      .join('\n\n---\n\n');

    return `${styleRules}\n\n以下是相关设定和上下文：\n\n${canonContext}${formatWorkflowLog(context)}`;
  }

  private buildUserPrompt(context: WritingContextPacket): string {
    const draftContext = context.relevantDrafts
      .map(d => `【${d.source}】\n${d.content}`)
      .join('\n\n---\n\n');

    return `任务：${context.task}\n\n相关草稿：\n${draftContext}\n\n约束：\n${context.constraints.join('\n')}`;
  }
}

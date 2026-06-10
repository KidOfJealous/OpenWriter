import type {
  WritingAgent,
  WritingContextPacket,
  AgentResult,
  AgentOptions,
  LLMProvider,
} from '@openwriter/core';
import { DeepSeekProvider } from '@openwriter/core';

interface CritiqueItem {
  priority: 'P0' | 'P1' | 'P2';
  dimension: 'structure' | 'character' | 'pacing' | 'setting' | 'prose';
  description: string;
  suggestion?: string;
}

export class Critic implements WritingAgent {
  name = 'critic';
  description = '多维审稿：结构、人物、节奏、设定、语言';

  private provider: LLMProvider;

  constructor(provider?: LLMProvider) {
    this.provider = provider ?? new DeepSeekProvider();
  }

  async execute(context: WritingContextPacket, options?: AgentOptions): Promise<AgentResult> {
    const prompt = this.buildPrompt(context);

    const result = await this.provider.chatJson<CritiqueItem[]>(
      [
        {
          role: 'system',
          content: '你是一个严厉的审稿人。从结构、人物、节奏、设定、语言五个维度批评文本。只返回 JSON 数组，不要额外解释。',
        },
        { role: 'user', content: prompt },
      ],
      {},
      {
        model: options?.model,
        temperature: options?.temperature ?? 0.3,
        maxTokens: options?.maxTokens,
      },
    );

    const p0 = result.filter(r => r.priority === 'P0');
    const p1 = result.filter(r => r.priority === 'P1');
    const p2 = result.filter(r => r.priority === 'P2');

    return {
      type: 'json',
      content: result,
      metadata: {
        model: options?.model ?? 'deepseek-chat',
        p0Count: p0.length,
        p1Count: p1.length,
        p2Count: p2.length,
        providerUsage: this.provider.getLastUsage?.(),
      },
    };
  }

  private buildPrompt(context: WritingContextPacket): string {
    const draftText = context.relevantDrafts
      .map(d => `【${d.source}】\n${d.content}`)
      .join('\n\n---\n\n');

    const canonText = context.relevantCanon
      .map(e => `【${e.source}】\n${e.content.slice(0, 300)}`)
      .join('\n\n---\n\n');

    return `请审稿以下文本：

【相关设定】
${canonText}

【待审文本】
${draftText}

【任务】
${context.task}

请返回审稿意见，每条包含：
- priority: "P0"（必须改）/ "P1"（建议改）/ "P2"（可选优化）
- dimension: "structure" | "character" | "pacing" | "setting" | "prose"
- description: 问题描述
- suggestion: 修改建议（可选）

如果没有问题，返回空数组 []。`;
  }
}

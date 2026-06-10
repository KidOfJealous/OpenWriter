import type {
  WritingAgent,
  WritingContextPacket,
  AgentResult,
  AgentOptions,
  LLMProvider,
} from '@openwriter/core';
import { DeepSeekProvider } from '@openwriter/core';

interface ContinuityIssue {
  severity: 'hard' | 'soft' | 'uncertain';
  description: string;
  source?: string;
}

export class ContinuityChecker implements WritingAgent {
  name = 'continuity-checker';
  description = '检查设定冲突、人物关系冲突、时间线冲突';

  private provider: LLMProvider;

  constructor(provider?: LLMProvider) {
    this.provider = provider ?? new DeepSeekProvider();
  }

  async execute(context: WritingContextPacket, options?: AgentOptions): Promise<AgentResult> {
    const prompt = this.buildPrompt(context);

    const result = await this.provider.chatJson<ContinuityIssue[]>(
      [
        { role: 'system', content: '你是一个连续性检查器。检查文本和设定之间的冲突。只返回 JSON 数组，不要额外解释。' },
        { role: 'user', content: prompt },
      ],
      {},
      {
        model: options?.model,
        temperature: options?.temperature ?? 0.2,
        maxTokens: options?.maxTokens,
      },
    );

    return {
      type: 'json',
      content: result,
      metadata: {
        model: options?.model ?? 'deepseek-chat',
        hardConflicts: result.filter(r => r.severity === 'hard').length,
        softRisks: result.filter(r => r.severity === 'soft').length,
        uncertainties: result.filter(r => r.severity === 'uncertain').length,
        providerUsage: this.provider.getLastUsage?.(),
      },
    };
  }

  private buildPrompt(context: WritingContextPacket): string {
    const canonText = context.relevantCanon
      .map(e => `【${e.source}】\n${e.content}`)
      .join('\n\n---\n\n');

    const draftText = context.relevantDrafts
      .map(d => `【${d.source}】\n${d.content}`)
      .join('\n\n---\n\n');

    const deprecatedText = context.deprecatedItems
      .map(d => `已废弃：${d.old}${d.replacement ? ` → 替换为：${d.replacement}` : ''}`)
      .join('\n');

    return `请检查以下内容是否存在设定冲突：

【已有设定】
${canonText}

【当前文本】
${draftText}

【已废弃设定】
${deprecatedText}

【任务】
${context.task}

【约束】
${context.constraints.join('\n')}

请返回检查结果，每个问题包含：
- severity: "hard"（硬冲突，必须改）/ "soft"（软风险，建议改）/ "uncertain"（待确认）
- description: 问题描述
- source: 相关来源（可选）

如果没有问题，返回空数组 []。`;
  }
}

import type {
  WritingAgent,
  WritingContextPacket,
  AgentResult,
  AgentOptions,
  LLMProvider,
} from '@openwriter/core';
import { DeepSeekProvider } from '@openwriter/core';

interface WorldbuildingIssue {
  category: 'institution' | 'geography' | 'culture' | 'technology' | 'magic' | 'terminology';
  issue: string;
  severity: 'hard' | 'soft' | 'suggestion';
  suggestion: string;
  isSelfConsistent: boolean;
}

export class WorldbuildingAgent implements WritingAgent {
  name = 'worldbuilding-agent';
  description = '设计制度、地理、族群、宗教、技术、能力体系，检查自洽性';

  private provider: LLMProvider;

  constructor(provider?: LLMProvider) {
    this.provider = provider ?? new DeepSeekProvider();
  }

  async execute(context: WritingContextPacket, options?: AgentOptions): Promise<AgentResult> {
    const prompt = this.buildPrompt(context);

    const result = await this.provider.chatJson<WorldbuildingIssue[]>(
      [
        {
          role: 'system',
          content: '你是一个世界观编辑。检查制度、地理、族群、宗教、技术、能力体系是否自洽。只返回 JSON 数组。',
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

    return {
      type: 'json',
      content: result,
      metadata: {
        issueCount: result.length,
        hardConflicts: result.filter(r => r.severity === 'hard').length,
        inconsistentItems: result.filter(r => !r.isSelfConsistent).length,
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

    return `请检查以下文本的世界观设定：

【已有世界观设定】
${canonText}

【新文本】
${draftText}

【任务】
${context.task}

请检查：
- 制度/官制是否前后一致
- 地理是否矛盾
- 族群/宗教设定是否冲突
- 技术/能力体系是否自洽
- 称谓/术语使用是否统一
- 新设定是否过度膨胀

对每个问题返回：
- category: "institution" | "geography" | "culture" | "technology" | "magic" | "terminology"
- issue: 问题描述
- severity: "hard" | "soft" | "suggestion"
- suggestion: 改法
- isSelfConsistent: 是否自洽（boolean）`;
  }
}

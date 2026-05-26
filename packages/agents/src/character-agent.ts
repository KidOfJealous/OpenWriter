import type {
  WritingAgent,
  WritingContextPacket,
  AgentResult,
  AgentOptions,
  LLMProvider,
} from '@openwriter/core';
import { DeepSeekProvider } from '@openwriter/core';

interface CharacterAnalysis {
  name: string;
  wants: string;
  fears: string;
  misconceptions: string;
  cannotAdmit: string;
  arcChange: string;
  isOOC: boolean;
  oocReasons?: string[];
}

export class CharacterAgent implements WritingAgent {
  name = 'character-agent';
  description = '检查人物动机、维护人物弧线、判断是否 OOC、生成角色小传';

  private provider: LLMProvider;

  constructor(provider?: LLMProvider) {
    this.provider = provider ?? new DeepSeekProvider();
  }

  async execute(context: WritingContextPacket, options?: AgentOptions): Promise<AgentResult> {
    const prompt = this.buildPrompt(context);

    const result = await this.provider.chatJson<CharacterAnalysis[]>(
      [
        {
          role: 'system',
          content: '你是一个人物编辑。分析文本中的人物状态。人物不是设定条目，而是欲望、恐惧、误判、代价的组合。只返回 JSON 数组。',
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
        characterCount: result.length,
        oocCount: result.filter(c => c.isOOC).length,
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

    return `请分析以下文本中的人物状态：

【角色设定】
${canonText}

【当前文本】
${draftText}

【任务】
${context.task}

对每个人物返回：
- name: 角色名
- wants: 当前想要什么
- fears: 当前害怕什么
- misconceptions: 对谁有误解
- cannotAdmit: 当前不能承认什么
- arcChange: 本章应该发生什么变化
- isOOC: 是否 OOC（boolean）
- oocReasons: OOC 原因（如果 isOOC 为 true）`;
  }
}

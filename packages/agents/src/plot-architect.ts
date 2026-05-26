import type {
  WritingAgent,
  WritingContextPacket,
  AgentResult,
  AgentOptions,
  LLMProvider,
} from '@openwriter/core';
import { DeepSeekProvider } from '@openwriter/core';

interface PlotAnalysis {
  issue: string;
  severity: 'low' | 'medium' | 'high';
  suggestion: string;
  conflictLevel: 'internal' | 'interpersonal' | 'societal' | 'cosmic';
  pacingIssue: boolean;
  foreshadowing: boolean;
}

export class PlotArchitect implements WritingAgent {
  name = 'plot-architect';
  description = '设计情节因果链、提升冲突强度、分析节奏、检查伏笔和反转';

  private provider: LLMProvider;

  constructor(provider?: LLMProvider) {
    this.provider = provider ?? new DeepSeekProvider();
  }

  async execute(context: WritingContextPacket, options?: AgentOptions): Promise<AgentResult> {
    const prompt = this.buildPrompt(context);

    const result = await this.provider.chatJson<PlotAnalysis[]>(
      [
        {
          role: 'system',
          content: '你是一个剧情结构编辑。分析情节因果链、冲突强度、节奏、伏笔。只返回 JSON 数组。',
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
        highSeverity: result.filter(r => r.severity === 'high').length,
        pacingIssues: result.filter(r => r.pacingIssue).length,
      },
    };
  }

  private buildPrompt(context: WritingContextPacket): string {
    const canonText = context.relevantCanon
      .map(e => `【${e.source}】\n${e.content.slice(0, 300)}`)
      .join('\n\n---\n\n');

    const draftText = context.relevantDrafts
      .map(d => `【${d.source}】\n${d.content}`)
      .join('\n\n---\n\n');

    return `请分析以下文本的剧情结构：

【相关设定】
${canonText}

【当前文本】
${draftText}

【任务】
${context.task}

请从以下维度分析：
- 情节因果链是否完整
- 冲突强度是否足够（私人→人际→制度→宇宙）
- 节奏是否有变化
- 伏笔是否埋下
- 是否有反转和代价

对每个问题返回：
- issue: 问题描述
- severity: "low" | "medium" | "high"
- suggestion: 改法建议
- conflictLevel: "internal" | "interpersonal" | "societal" | "cosmic"
- pacingIssue: 是否有节奏问题（boolean）
- foreshadowing: 是否涉及伏笔（boolean）`;
  }
}

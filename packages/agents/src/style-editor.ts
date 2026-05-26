import type {
  WritingAgent,
  WritingContextPacket,
  AgentResult,
  AgentOptions,
  LLMProvider,
} from '@openwriter/core';
import { DeepSeekProvider } from '@openwriter/core';
import { formatWorkflowLog } from './prompt-cache.js';

interface StyleIssue {
  type: 'translationese' | 'repetition' | 'ai_taste' | 'over_explain' | 'slogan' | 'modern_register' | 'pov_break' | 'other';
  line: string;
  issue: string;
  suggestion: string;
}

export class StyleEditor implements WritingAgent {
  name = 'style-editor';
  description = '控制语言风格、降低翻译腔、增强中文韵律、统一叙述视角、检查 AI 味';

  private provider: LLMProvider;

  constructor(provider?: LLMProvider) {
    this.provider = provider ?? new DeepSeekProvider();
  }

  async execute(context: WritingContextPacket, options?: AgentOptions): Promise<AgentResult> {
    const prompt = this.buildPrompt(context);

    const result = await this.provider.chatJson<StyleIssue[]>(
      [
        {
          role: 'system',
          content: '你是一个文风编辑。只改表达，不改剧情。检查翻译腔、AI 味、重复句式、过度解释、口号化、现代腔、视角跳跃。只返回 JSON 数组。',
        },
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
        issueCount: result.length,
        translationese: result.filter(r => r.type === 'translationese').length,
        aiTaste: result.filter(r => r.type === 'ai_taste').length,
        overExplain: result.filter(r => r.type === 'over_explain').length,
        providerUsage: this.provider.getLastUsage?.(),
      },
    };
  }

  private buildPrompt(context: WritingContextPacket): string {
    const style = context.projectProfile.style;
    const styleRules: string[] = [];

    if (style?.proseProfile) styleRules.push(`文风定位：${style.proseProfile}`);
    if (style?.descriptionDensity) styleRules.push(`描写密度：${style.descriptionDensity}`);
    if (style?.dialogueStyle) styleRules.push(`对白风格：${style.dialogueStyle}`);
    if (style?.pov) styleRules.push(`叙述视角：${style.pov}`);
    if (style?.taboo?.length) styleRules.push(`禁忌：${style.taboo.join('、')}`);

    const draftText = context.relevantDrafts
      .map(d => `【${d.source}】\n${d.content}`)
      .join('\n\n---\n\n');

    return `请审校以下文本的文风：

【文风要求】
${styleRules.join('\n')}
${formatWorkflowLog(context)}

【待审文本】
${draftText}

请检查：
- 翻译腔（欧化句式）
- 重复句式/词汇
- AI 味（过度修饰、空洞形容）
- 过度解释（旁白替角色总结情绪）
- 口号化（喊口号式对白）
- 现代腔（与时代不符的表达）
- 视角跳跃（违反 POV 限制）

对每个问题返回：
- type: "translationese" | "repetition" | "ai_taste" | "over_explain" | "slogan" | "modern_register" | "pov_break" | "other"
- line: 有问题的原文（不超过 30 字）
- issue: 问题描述
- suggestion: 修改建议`;
  }
}

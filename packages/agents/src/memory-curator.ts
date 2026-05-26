import type {
  WritingAgent,
  WritingContextPacket,
  AgentResult,
  AgentOptions,
  MemoryState,
  LLMProvider,
} from '@openwriter/core';
import { DeepSeekProvider } from '@openwriter/core';
import { formatWorkflowLog } from './prompt-cache.js';

interface MemoryChange {
  type: 'new' | 'modified' | 'deprecated';
  category: 'setting' | 'character' | 'timeline' | 'other';
  content: string;
  suggestedState: MemoryState;
  reason: string;
}

export class MemoryCurator implements WritingAgent {
  name = 'memory-curator';
  description = '提取新增设定、人物变化、时间线变化，生成 changelog';

  private provider: LLMProvider;

  constructor(provider?: LLMProvider) {
    this.provider = provider ?? new DeepSeekProvider();
  }

  async execute(context: WritingContextPacket, options?: AgentOptions): Promise<AgentResult> {
    const prompt = this.buildPrompt(context);

    const changes = await this.provider.chatJson<MemoryChange[]>(
      [
        {
          role: 'system',
          content: '你是一个记忆整理编辑。提取文本中的新设定和变化。新增内容默认状态为 candidate。只返回 JSON 数组。',
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
      content: {
        changes,
        changelog: this.formatChangelog(changes),
      },
      metadata: {
        model: options?.model ?? 'deepseek-chat',
        newCount: changes.filter(c => c.type === 'new').length,
        modifiedCount: changes.filter(c => c.type === 'modified').length,
        deprecatedCount: changes.filter(c => c.type === 'deprecated').length,
        providerUsage: this.provider.getLastUsage?.(),
      },
    };
  }

  private buildPrompt(context: WritingContextPacket): string {
    const canonText = context.relevantCanon
      .map(e => `【${e.source}】(${e.status})\n${e.content.slice(0, 300)}`)
      .join('\n\n---\n\n');

    const draftText = context.relevantDrafts
      .map(d => `【${d.source}】\n${d.content}`)
      .join('\n\n---\n\n');

    return `请整理以下文本中的设定变化：

【已有设定】
${canonText}
${formatWorkflowLog(context)}

【新文本】
${draftText}

【任务】
${context.task}

请提取变化，每条包含：
- type: "new" | "modified" | "deprecated"
- category: "setting" | "character" | "timeline" | "other"
- content: 变化内容
- suggestedState: "idea" | "candidate" | "canon" | "deprecated"（新增内容默认为 candidate）
- reason: 变化原因`;
  }

  private formatChangelog(changes: MemoryChange[]): string {
    const lines = changes.map(c => {
      const stateTag = `[${c.suggestedState}]`;
      const typeTag = c.type === 'new' ? '新增' : c.type === 'modified' ? '修改' : '废弃';
      return `${stateTag} ${typeTag} (${c.category}): ${c.content}`;
    });
    return lines.join('\n');
  }
}

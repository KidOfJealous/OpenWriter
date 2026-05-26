import type {
  WritingAgent,
  WritingContextPacket,
  AgentResult,
  AgentOptions,
  CanonEntry,
  DraftEntry,
  DeprecatedEntry,
  ProjectProfile,
} from '@openwriter/core';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

export class ContextRetriever implements WritingAgent {
  name = 'context-retriever';
  description = '从项目文件中检索相关设定、角色、时间线，生成上下文包';

  async execute(context: WritingContextPacket, _options?: AgentOptions): Promise<AgentResult> {
    const projectDir = process.cwd();
    const profile = context.projectProfile;

    const canon = this.loadCanonEntries(projectDir, profile);
    const drafts = this.loadDraftEntries(projectDir, profile);
    const deprecated = this.loadDeprecatedEntries(projectDir, profile);

    // Score and rank canon entries by relevance to task
    const retrievalConfig = profile.retrieval;
    const scoredCanon = this.scoreAndRank(canon, context.task, retrievalConfig);
    const scoredDrafts = this.scoreAndRank(drafts.map(d => ({ ...d, status: 'canon' as const, source: d.source, content: d.content, tags: [] as string[] })), context.task, retrievalConfig);

    const packet: WritingContextPacket = {
      ...context,
      relevantCanon: scoredCanon.map(s => s.entry),
      relevantDrafts: scoredDrafts.slice(0, 5).map(s => ({
        source: (s.entry as any).source,
        content: (s.entry as any).content,
      })),
      deprecatedItems: deprecated,
    };

    return {
      type: 'json',
      content: {
        packet,
        summary: {
          canonCount: canon.length,
          draftCount: drafts.length,
          deprecatedCount: deprecated.length,
          taskEntities: this.extractTaskEntities(context.task),
          relevanceScores: scoredCanon.slice(0, 5).map(s => ({
            source: s.entry.source,
            score: s.score,
          })),
        },
      },
    };
  }

  private scoreAndRank<T extends { content: string; status?: string }>(
    entries: T[],
    query: string,
    config?: { exactMatchWeight?: number; vectorWeight?: number; recencyWeight?: number; deprecatedPenalty?: number },
  ): Array<{ entry: T; score: number }> {
    const exactWeight = config?.exactMatchWeight ?? 0.5;
    const deprecatedPenalty = config?.deprecatedPenalty ?? 0.8;

    const queryTerms = this.tokenize(query);
    const scored = entries.map(entry => {
      const contentTerms = this.tokenize(entry.content);
      const exactScore = this.exactMatchScore(queryTerms, contentTerms);
      let score = exactWeight * exactScore;

      // Penalize deprecated items
      if (entry.status === 'deprecated') {
        score *= deprecatedPenalty;
      }

      return { entry, score };
    });

    return scored.sort((a, b) => b.score - a.score);
  }

  private tokenize(text: string): string[] {
    // Chinese: split into characters and bigrams
    // English: split by whitespace and lowercase
    const chinese = text.match(/[\u4e00-\u9fff]+/g) ?? [];
    const english = text.match(/[a-zA-Z]+/g) ?? [];

    const terms: string[] = [];

    for (const segment of chinese) {
      // Single characters
      for (const char of segment) {
        terms.push(char);
      }
      // Bigrams
      for (let i = 0; i < segment.length - 1; i++) {
        terms.push(segment.slice(i, i + 2));
      }
    }

    for (const word of english) {
      terms.push(word.toLowerCase());
    }

    return terms;
  }

  private exactMatchScore(queryTerms: string[], contentTerms: string[]): number {
    if (queryTerms.length === 0) return 0;
    const contentSet = new Set(contentTerms);
    let matches = 0;
    for (const term of queryTerms) {
      if (contentSet.has(term)) matches++;
    }
    return matches / queryTerms.length;
  }

  private loadCanonEntries(projectDir: string, profile: ProjectProfile): CanonEntry[] {
    const entries: CanonEntry[] = [];
    for (const dir of profile.sourceOfTruth) {
      const fullPath = resolve(projectDir, dir);
      if (!existsSync(fullPath)) continue;
      entries.push(...this.readMarkdownFiles(fullPath));
    }
    return entries;
  }

  private loadDraftEntries(projectDir: string, profile: ProjectProfile): DraftEntry[] {
    const entries: DraftEntry[] = [];
    for (const dir of profile.draftDirs) {
      const fullPath = resolve(projectDir, dir);
      if (!existsSync(fullPath)) continue;
      for (const file of this.findMarkdownFiles(fullPath)) {
        const content = readFileSync(file, 'utf-8');
        entries.push({
          source: file,
          content,
          lastModified: statSync(file).mtime.toISOString(),
        });
      }
    }
    return entries;
  }

  private loadDeprecatedEntries(_projectDir: string, _profile: ProjectProfile): DeprecatedEntry[] {
    // MVP: 空实现，后续从 deprecated index 文件读取
    return [];
  }

  private readMarkdownFiles(dir: string): CanonEntry[] {
    const entries: CanonEntry[] = [];
    for (const file of this.findMarkdownFiles(dir)) {
      const content = readFileSync(file, 'utf-8');
      entries.push({
        source: file,
        status: 'canon',
        content,
        tags: [],
      });
    }
    return entries;
  }

  private findMarkdownFiles(dir: string): string[] {
    const files: string[] = [];
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files.push(...this.findMarkdownFiles(fullPath));
      } else if (entry.endsWith('.md') || entry.endsWith('.txt')) {
        files.push(fullPath);
      }
    }
    return files;
  }

  private extractTaskEntities(task: string): string[] {
    // MVP: 简单提取，后续用 NLP
    const entities: string[] = [];
    const patterns = /第[零一二三四五六七八九十百\d]+[章节回]/g;
    const matches = task.match(patterns);
    if (matches) entities.push(...matches);
    return entities;
  }
}

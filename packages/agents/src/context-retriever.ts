import type {
  WritingAgent,
  WritingContextPacket,
  AgentResult,
  AgentOptions,
  AggressiveCachePolicy,
  CanonEntry,
  DraftEntry,
  DeprecatedEntry,
  ProjectProfile,
} from '@openwriter/core';
import { hashText, resolveAggressiveCachePolicy } from '@openwriter/core';
import { readFileSync, readdirSync, statSync } from 'fs';
import { extname, join, relative, resolve } from 'path';

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.text', '.rst', '.adoc']);
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.obsidian',
  '.qoder',
  '.vscode',
  'node_modules',
  'dist',
  'build',
  'release',
  'coverage',
]);

interface CachedFile {
  mtimeMs: number;
  size: number;
  content: string;
}

export class ContextRetriever implements WritingAgent {
  name = 'context-retriever';
  description = 'Find relevant writing context from the current workspace.';

  private static fileCache = new Map<string, CachedFile>();
  private static tokenCache = new Map<string, string[]>();
  private fileCacheHits = 0;
  private fileCacheMisses = 0;
  private tokenCacheHits = 0;
  private tokenCacheMisses = 0;

  async execute(context: WritingContextPacket, _options?: AgentOptions): Promise<AgentResult> {
    this.resetRunStats();
    const projectDir = process.cwd();
    const profile = context.projectProfile;
    const policy = resolveAggressiveCachePolicy(profile.cache);

    const canon: CanonEntry[] = [];
    const drafts = this.loadWorkspaceEntries(projectDir);
    const deprecated = this.loadDeprecatedEntries(projectDir, profile);

    const retrievalConfig = profile.retrieval;
    const scoredCanon = this.scoreAndRank(canon, context.task, retrievalConfig);
    const scoredDrafts = this.scoreAndRank(
      drafts.map(d => ({ ...d, status: 'canon' as const, tags: [] as string[] })),
      context.task,
      retrievalConfig,
    );

    const selectedCanon = this.selectCanonEntries(canon, scoredCanon, policy);
    const selectedDrafts = this.selectScored(scoredDrafts, policy.maxDraftEntries, false);
    const relevantDrafts = this.mergeDrafts(
      context.relevantDrafts,
      selectedDrafts.map(s => ({
        source: s.entry.source,
        content: s.entry.content,
        lastModified: s.entry.lastModified,
      })),
      policy.maxDraftEntries,
    );

    const packet: WritingContextPacket = {
      ...context,
      relevantCanon: selectedCanon.map(s => s.entry),
      relevantDrafts,
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
          relevanceScores: scoredDrafts.slice(0, 5).map(s => ({
            source: s.entry.source,
            score: s.score,
          })),
          cache: {
            policy: policy.strategy,
            selectedCanon: selectedCanon.length,
            selectedDrafts: selectedDrafts.length,
            fileHits: this.fileCacheHits,
            fileMisses: this.fileCacheMisses,
            tokenHits: this.tokenCacheHits,
            tokenMisses: this.tokenCacheMisses,
          },
        },
      },
      metadata: {
        fileCacheHits: this.fileCacheHits,
        fileCacheMisses: this.fileCacheMisses,
        tokenCacheHits: this.tokenCacheHits,
        tokenCacheMisses: this.tokenCacheMisses,
      },
    };
  }

  private resetRunStats(): void {
    this.fileCacheHits = 0;
    this.fileCacheMisses = 0;
    this.tokenCacheHits = 0;
    this.tokenCacheMisses = 0;
  }

  private scoreAndRank<T extends { content: string; source?: string; status?: string; lastModified?: string }>(
    entries: T[],
    query: string,
    config?: { exactMatchWeight?: number; vectorWeight?: number; recencyWeight?: number; deprecatedPenalty?: number },
  ): Array<{ entry: T; score: number }> {
    const exactWeight = config?.exactMatchWeight ?? 0.5;
    const vectorWeight = config?.vectorWeight ?? 0.3;
    const recencyWeight = config?.recencyWeight ?? 0.2;
    const deprecatedPenalty = config?.deprecatedPenalty ?? 0.8;

    const queryTerms = this.tokenize(query);
    const scored = entries.map(entry => {
      const contentTerms = this.tokenize(`${entry.source ?? ''}\n${entry.content}`);
      const exactScore = this.exactMatchScore(queryTerms, contentTerms);
      const vectorScore = this.termVectorScore(queryTerms, contentTerms);
      const recencyScore = this.recencyScore(entry.lastModified);
      let score = (exactWeight * exactScore)
        + (vectorWeight * vectorScore)
        + (recencyWeight * recencyScore);

      if (entry.status === 'deprecated') {
        score *= deprecatedPenalty;
      }

      return { entry, score };
    });

    return scored.sort((a, b) => b.score - a.score);
  }

  private tokenize(text: string): string[] {
    const cacheKey = hashText(text);
    const cached = ContextRetriever.tokenCache.get(cacheKey);
    if (cached) {
      this.tokenCacheHits++;
      return cached;
    }

    this.tokenCacheMisses++;
    const chinese = text.match(/[\u4e00-\u9fff]+/g) ?? [];
    const english = text.match(/[a-zA-Z]+/g) ?? [];
    const terms: string[] = [];

    for (const segment of chinese) {
      for (const char of segment) {
        terms.push(char);
      }
      for (let i = 0; i < segment.length - 1; i++) {
        terms.push(segment.slice(i, i + 2));
      }
    }

    for (const word of english) {
      terms.push(word.toLowerCase());
    }

    ContextRetriever.tokenCache.set(cacheKey, terms);
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

  private termVectorScore(queryTerms: string[], contentTerms: string[]): number {
    if (queryTerms.length === 0 || contentTerms.length === 0) return 0;
    const queryVector = this.termCounts(queryTerms);
    const contentVector = this.termCounts(contentTerms);
    let dot = 0;
    let queryMagnitude = 0;
    let contentMagnitude = 0;

    for (const count of queryVector.values()) {
      queryMagnitude += count * count;
    }
    for (const count of contentVector.values()) {
      contentMagnitude += count * count;
    }
    for (const [term, queryCount] of queryVector) {
      dot += queryCount * (contentVector.get(term) ?? 0);
    }

    if (queryMagnitude === 0 || contentMagnitude === 0) return 0;
    return dot / (Math.sqrt(queryMagnitude) * Math.sqrt(contentMagnitude));
  }

  private termCounts(terms: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const term of terms) {
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
    return counts;
  }

  private recencyScore(lastModified?: string): number {
    if (!lastModified) return 0;
    const modified = Date.parse(lastModified);
    if (Number.isNaN(modified)) return 0;
    const ageMs = Math.max(0, Date.now() - modified);
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    return 1 / (1 + ageDays / 30);
  }

  private selectCanonEntries(
    canon: CanonEntry[],
    scoredCanon: Array<{ entry: CanonEntry; score: number }>,
    policy: AggressiveCachePolicy,
  ): Array<{ entry: CanonEntry; score: number }> {
    if (!policy.stablePrefix || policy.strategy !== 'aggressive') {
      return this.selectScored(scoredCanon, policy.maxCanonEntries, false);
    }

    const scoreByEntry = new Map(scoredCanon.map(item => [item.entry, item.score]));
    return [...canon]
      .sort((a, b) => {
        const sourceCompare = a.source.localeCompare(b.source);
        if (sourceCompare !== 0) return sourceCompare;
        return hashText(a.content).localeCompare(hashText(b.content));
      })
      .slice(0, policy.maxCanonEntries)
      .map(entry => ({
        entry,
        score: scoreByEntry.get(entry) ?? 0,
      }));
  }

  private mergeDrafts(existing: DraftEntry[], selected: DraftEntry[], maxEntries: number): DraftEntry[] {
    const seen = new Set<string>();
    const merged: DraftEntry[] = [];

    for (const entry of [...existing, ...selected]) {
      const key = `${entry.source}:${hashText(entry.content)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(entry);
      if (merged.length >= maxEntries) break;
    }

    return merged;
  }

  private loadWorkspaceEntries(projectDir: string): DraftEntry[] {
    return this.findWorkspaceTextFiles(projectDir).map(file => ({
      source: this.toWorkspacePath(projectDir, file),
      content: this.readCachedFile(file),
      lastModified: statSync(file).mtime.toISOString(),
    }));
  }

  private loadDeprecatedEntries(_projectDir: string, _profile: ProjectProfile): DeprecatedEntry[] {
    return [];
  }

  private findWorkspaceTextFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || IGNORED_DIRECTORIES.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.findWorkspaceTextFiles(fullPath));
      } else if (TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
    return files;
  }

  private selectScored<T extends { source?: string; content: string }>(
    scored: Array<{ entry: T; score: number }>,
    maxEntries: number,
    stableOrder: boolean,
  ): Array<{ entry: T; score: number }> {
    const selected = scored.slice(0, maxEntries);
    if (!stableOrder) return selected;

    return [...selected].sort((a, b) => {
      const sourceCompare = (a.entry.source ?? '').localeCompare(b.entry.source ?? '');
      if (sourceCompare !== 0) return sourceCompare;
      return hashText(a.entry.content).localeCompare(hashText(b.entry.content));
    });
  }

  private readCachedFile(file: string): string {
    const stat = statSync(file);
    const cached = ContextRetriever.fileCache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      this.fileCacheHits++;
      return cached.content;
    }

    this.fileCacheMisses++;
    const content = readFileSync(file, 'utf-8');
    ContextRetriever.fileCache.set(file, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      content,
    });
    return content;
  }

  private toWorkspacePath(projectDir: string, file: string): string {
    return relative(projectDir, resolve(file)).replace(/\\/g, '/');
  }

  private extractTaskEntities(task: string): string[] {
    const entities: string[] = [];
    const matches = task.match(/第[零一二三四五六七八九十百\d]+[章节回]/g);
    if (matches) entities.push(...matches);
    return entities;
  }
}

import { describe, it, expect } from 'vitest';
import { ContextRetriever } from '../src/context-retriever';

describe('context-retriever', () => {
  const retriever = new ContextRetriever();

  it('tokenizes Chinese text into characters and bigrams', () => {
    const tokenize = (retriever as any).tokenize.bind(retriever);
    const terms = tokenize('林上调查案件');
    expect(terms).toContain('林');
    expect(terms).toContain('林上');
    expect(terms).toContain('调查');
  });

  it('tokenizes English text correctly', () => {
    const tokenize = (retriever as any).tokenize.bind(retriever);
    const terms = tokenize('Hello World');
    expect(terms).toContain('hello');
    expect(terms).toContain('world');
  });

  it('scores exact match correctly', () => {
    const score = (retriever as any).exactMatchScore.bind(retriever);
    expect(score(['lin', 'case'], ['lin', 'case', 'archive'])).toBe(1);
    expect(score(['lin', 'case'], ['lin', 'dinner'])).toBe(0.5);
    expect(score(['lin', 'case'], ['sleep', 'dinner'])).toBe(0);
    expect(score([], ['lin'])).toBe(0);
  });

  it('uses configured vector and recency weights when ranking', () => {
    const scoreAndRank = (retriever as any).scoreAndRank.bind(retriever);
    const fresh = new Date().toISOString();
    const old = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

    const ranked = scoreAndRank(
      [
        { source: 'old.md', content: 'shared clue', lastModified: old },
        { source: 'fresh.md', content: 'shared clue', lastModified: fresh },
      ],
      'shared clue',
      { exactMatchWeight: 0, vectorWeight: 0, recencyWeight: 1 },
    );

    expect(ranked[0].entry.source).toBe('fresh.md');
  });

  it('keeps aggressive canon prefix stable instead of task-ranked', () => {
    const selectCanonEntries = (retriever as any).selectCanonEntries.bind(retriever);
    const canon = [
      { source: 'z.md', status: 'canon', content: 'perfect query match' },
      { source: 'a.md', status: 'canon', content: 'stable project context' },
    ];
    const scored = [
      { entry: canon[0], score: 1 },
      { entry: canon[1], score: 0 },
    ];

    const selected = selectCanonEntries(canon, scored, {
      enabled: true,
      strategy: 'aggressive',
      stablePrefix: true,
      appendOnlyWorkflowLog: true,
      maxCanonEntries: 1,
      maxDraftEntries: 8,
      maxCanonEntryChars: 4000,
      maxDraftEntryChars: 12000,
      maxWorkflowLogEntries: 12,
      maxResultChars: 1800,
      maxTotalContextChars: 120000,
    });

    expect(selected[0].entry.source).toBe('a.md');
  });
});

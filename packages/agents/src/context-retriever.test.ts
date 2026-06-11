import { describe, it, expect } from 'vitest';
import { ContextRetriever } from '../src/context-retriever';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { WritingContextPacket } from '@openwriter/core';

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
      maxCanonEntries: 1,
      maxDraftEntries: 8,
      maxCanonEntryChars: 4000,
      maxDraftEntryChars: 12000,
      maxTotalContextChars: 120000,
    });

    expect(selected[0].entry.source).toBe('a.md');
  });

  it('loads text context from the whole workspace instead of configured directories', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'openwriter-context-'));
    const oldCwd = process.cwd();
    try {
      mkdirSync(join(workspace, '人物', '狄人'), { recursive: true });
      mkdirSync(join(workspace, 'chapters'), { recursive: true });
      writeFileSync(join(workspace, '人物', '狄人', '夏原.md'), '夏原在春末抵达北境。', 'utf-8');
      writeFileSync(join(workspace, 'chapters', 'ignored-by-query.md'), '无关内容', 'utf-8');
      process.chdir(workspace);

      const result = await retriever.execute({
        task: '检查夏原时间线',
        projectProfile: {
          name: 'vault',
          language: 'zh-CN',
          genre: 'fantasy',
          sourceOfTruth: ['does-not-exist'],
          draftDirs: ['also-does-not-exist'],
        },
        relevantCanon: [],
        relevantDrafts: [],
        deprecatedItems: [],
        openQuestions: [],
        constraints: [],
      } satisfies WritingContextPacket);

      const content = result.content as { packet: WritingContextPacket };
      expect(content.packet.relevantDrafts[0].source).toBe('人物/狄人/夏原.md');
      expect(content.packet.relevantDrafts[0].content).toContain('夏原');
    } finally {
      process.chdir(oldCwd);
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('loads OpenWriter managed memory without requiring a user canon directory', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'openwriter-memory-'));
    const oldCwd = process.cwd();
    try {
      mkdirSync(join(workspace, '.openwriter', 'memory', 'characters'), { recursive: true });
      mkdirSync(join(workspace, 'chapters'), { recursive: true });
      writeFileSync(
        join(workspace, '.openwriter', 'memory', 'characters', '夏原.md'),
        '---\nstatus: canon\ncategory: character\n---\n\n夏原害怕深水，但会在必要时隐瞒这一点。',
        'utf-8',
      );
      writeFileSync(join(workspace, 'chapters', 'one.md'), '夏原经过码头。', 'utf-8');
      process.chdir(workspace);

      const result = await retriever.execute({
        task: '检查夏原是否会下水',
        projectProfile: {
          name: 'vault',
          language: 'zh-CN',
          genre: 'fantasy',
        },
        relevantCanon: [],
        relevantDrafts: [],
        deprecatedItems: [],
        openQuestions: [],
        constraints: [],
      } satisfies WritingContextPacket);

      const content = result.content as { packet: WritingContextPacket };
      expect(content.packet.relevantCanon[0].source).toBe('.openwriter/memory/characters/夏原.md');
      expect(content.packet.relevantCanon[0].content).toContain('害怕深水');
      expect(content.packet.relevantDrafts.some(entry => entry.source.startsWith('.openwriter/'))).toBe(false);
    } finally {
      process.chdir(oldCwd);
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

import { describe, it, expect } from 'vitest';
import {
  AggressiveCacheManager,
  hashText,
  resolveAggressiveCachePolicy,
  stableStringify,
} from '../src/cache';
import type { WritingContextPacket } from '../src/types';

const context: WritingContextPacket = {
  task: 'write',
  projectProfile: {
    name: 'test',
    language: 'zh-CN',
    genre: 'fantasy',
    sourceOfTruth: ['canon'],
    draftDirs: ['drafts'],
    cache: {
      maxCanonEntries: 1,
      maxCanonEntryChars: 8,
      maxDraftEntries: 1,
      maxDraftEntryChars: 8,
    },
  },
  relevantCanon: [
    { source: 'b.md', status: 'canon', content: '第二条设定很长很长' },
    { source: 'a.md', status: 'canon', content: '第一条设定很长很长' },
  ],
  relevantDrafts: [
    { source: 'chapter-1.md', content: '正文内容很长很长' },
    { source: 'chapter-2.md', content: '第二章正文' },
  ],
  deprecatedItems: [],
  openQuestions: [],
  constraints: [],
};

describe('aggressive cache', () => {
  it('stable stringifies object keys', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(hashText('same')).toBe(hashText('same'));
  });

  it('resolves aggressive defaults', () => {
    const policy = resolveAggressiveCachePolicy({ maxCanonEntries: 2 });
    expect(policy.enabled).toBe(true);
    expect(policy.strategy).toBe('aggressive');
    expect(policy.maxCanonEntries).toBe(2);
  });

  it('trims context entries to configured limits', () => {
    const cache = new AggressiveCacheManager(context.projectProfile.cache);
    cache.prime(context);

    const prepared = cache.prepareForAgent(context);
    expect(prepared.relevantCanon).toHaveLength(1);
    expect(prepared.relevantDrafts).toHaveLength(1);
    expect(prepared.relevantCanon[0].content).toContain('cache-trimmed');
    expect(prepared.cache?.strategy).toBe('aggressive');
  });
});

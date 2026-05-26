import { describe, it, expect } from 'vitest';
import { resolveWorkflowOrder, WORKFLOWS } from '../src/workflow';

describe('workflow', () => {
  it('resolves workflow order correctly', () => {
    const order = resolveWorkflowOrder(WORKFLOWS.chapterWriting);
    expect(order[0]).toBe('context-retriever');
    expect(order.indexOf('prose-writer')).toBeGreaterThan(order.indexOf('context-retriever'));
    expect(order.indexOf('continuity-checker')).toBeGreaterThan(order.indexOf('prose-writer'));
  });

  it('handles diamond dependencies', () => {
    // brainstorm has critic depending on 3 agents all depending on context-retriever
    const order = resolveWorkflowOrder(WORKFLOWS.brainstorm);
    expect(order[0]).toBe('context-retriever');
    expect(order[order.length - 1]).toBe('critic');
    expect(order).toContain('plot-architect');
    expect(order).toContain('character-agent');
    expect(order).toContain('worldbuilding-agent');
  });

  it('has all 5 workflow types defined', () => {
    expect(Object.keys(WORKFLOWS)).toEqual([
      'brainstorm',
      'setting',
      'chapterWriting',
      'polish',
      'continuityCheck',
    ]);
  });
});

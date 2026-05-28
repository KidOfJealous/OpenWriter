import { describe, it, expect } from 'vitest';
import { planAgentLoop, resolveWorkflowOrder, WORKFLOWS } from '../src';
import type { WritingContextPacket } from '../src';

const context = (task: string): WritingContextPacket => ({
  task,
  projectProfile: {
    name: 'test',
    language: 'zh-CN',
    genre: 'fantasy',
    sourceOfTruth: [],
    draftDirs: [],
  },
  relevantCanon: [],
  relevantDrafts: [],
  deprecatedItems: [],
  openQuestions: [],
  constraints: [],
});

describe('workflow', () => {
  it('resolves workflow order correctly', () => {
    const order = resolveWorkflowOrder(WORKFLOWS.chapterWriting);
    expect(order).toEqual(['context-retriever', 'prose-writer', 'continuity-checker']);
  });

  it('keeps static fallback workflows narrow', () => {
    expect(resolveWorkflowOrder(WORKFLOWS.brainstorm)).toEqual([
      'context-retriever',
      'plot-architect',
    ]);
    expect(resolveWorkflowOrder(WORKFLOWS.continuityCheck)).toEqual([
      'context-retriever',
      'continuity-checker',
    ]);
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

  it('plans a chapter-writing loop without broad specialist fan-out', () => {
    const plan = planAgentLoop('chapterWriting', context('write the next scene'));
    expect(plan.steps.map(step => step.agent)).toEqual([
      'context-retriever',
      'prose-writer',
      'continuity-checker',
    ]);
    expect(plan.skippedAgents).toContain('character-agent');
    expect(plan.skippedAgents).toContain('worldbuilding-agent');
  });

  it('selects focused specialists when the task asks for them', () => {
    const plan = planAgentLoop(
      'brainstorm',
      context('brainstorm character motivation and worldbuilding rules'),
      { maxSpecialists: 2 },
    );

    expect(plan.steps.map(step => step.agent)).toEqual([
      'context-retriever',
      'character-agent',
      'worldbuilding-agent',
    ]);
    expect(plan.skippedAgents).toContain('plot-architect');
  });
});

import { describe, it, expect } from 'vitest';
import { Orchestrator } from '../src/orchestrator';
import type { WritingAgent, WritingContextPacket, AgentResult } from '../src/types';

const mockContext: WritingContextPacket = {
  task: 'test',
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
};

const createMockAgent = (name: string, result: AgentResult): WritingAgent => ({
  name,
  description: `Mock ${name}`,
  execute: async () => result,
});

describe('orchestrator', () => {
  it('registers and lists agents', () => {
    const orch = new Orchestrator();
    orch.register(createMockAgent('agent-a', { type: 'text', content: 'a' }));
    expect(orch.listAgents()).toEqual(['agent-a']);
  });

  it('executes a simple workflow', async () => {
    const orch = new Orchestrator();
    orch.register(createMockAgent('context-retriever', { type: 'text', content: 'retrieved' }));
    orch.register(createMockAgent('plot-architect', { type: 'text', content: 'plot' }));
    orch.register(createMockAgent('character-agent', { type: 'text', content: 'char' }));
    orch.register(createMockAgent('worldbuilding-agent', { type: 'text', content: 'world' }));
    orch.register(createMockAgent('critic', { type: 'text', content: 'critique' }));

    const results = await orch.executeWorkflow('brainstorm', mockContext);
    expect(results['context-retriever']).toBeDefined();
    expect(results['context-retriever'].content).toBe('retrieved');
    expect(results['critic']).toBeDefined();
  });

  it('throws on unknown workflow', async () => {
    const orch = new Orchestrator();
    await expect(
      orch.executeWorkflow('nonexistent' as any, mockContext),
    ).rejects.toThrow('Unknown workflow: nonexistent');
  });

  it('throws on unregistered agent', async () => {
    const orch = new Orchestrator();
    // Don't register any agent
    await expect(
      orch.executeWorkflow('brainstorm', mockContext),
    ).rejects.toThrow('Agent not registered');
  });
});

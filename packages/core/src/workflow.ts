import type { WorkflowName, WorkflowStep } from './types.js';

export const WORKFLOWS: Record<WorkflowName, WorkflowStep[]> = {
  // Workflow A: 脑暴
  brainstorm: [
    { agent: 'context-retriever' },
    { agent: 'plot-architect', dependsOn: ['context-retriever'] },
    { agent: 'character-agent', dependsOn: ['context-retriever'] },
    { agent: 'worldbuilding-agent', dependsOn: ['context-retriever'] },
    { agent: 'critic', dependsOn: ['plot-architect', 'character-agent', 'worldbuilding-agent'] },
  ],

  // Workflow B: 设定扩写
  setting: [
    { agent: 'context-retriever' },
    { agent: 'worldbuilding-agent', dependsOn: ['context-retriever'] },
    { agent: 'continuity-checker', dependsOn: ['worldbuilding-agent'] },
    { agent: 'memory-curator', dependsOn: ['continuity-checker'] },
  ],

  // Workflow C: 章节写作
  chapterWriting: [
    { agent: 'context-retriever' },
    { agent: 'plot-architect', dependsOn: ['context-retriever'] },
    { agent: 'character-agent', dependsOn: ['context-retriever'] },
    { agent: 'prose-writer', dependsOn: ['plot-architect', 'character-agent'] },
    { agent: 'continuity-checker', dependsOn: ['prose-writer'] },
    { agent: 'style-editor', dependsOn: ['prose-writer'] },
    { agent: 'critic', dependsOn: ['continuity-checker', 'style-editor'] },
  ],

  // Workflow D: 润色
  polish: [
    { agent: 'context-retriever' },
    { agent: 'style-editor', dependsOn: ['context-retriever'] },
    { agent: 'continuity-checker', dependsOn: ['style-editor'] },
  ],

  // Workflow E: 设定审稿
  continuityCheck: [
    { agent: 'context-retriever' },
    { agent: 'continuity-checker', dependsOn: ['context-retriever'] },
    { agent: 'worldbuilding-agent', dependsOn: ['context-retriever'] },
    { agent: 'character-agent', dependsOn: ['context-retriever'] },
    { agent: 'critic', dependsOn: ['continuity-checker', 'worldbuilding-agent', 'character-agent'] },
  ],
};

export function resolveWorkflowOrder(workflow: WorkflowStep[]): string[] {
  const order: string[] = [];
  const visited = new Set<string>();

  function visit(step: WorkflowStep) {
    if (visited.has(step.agent)) return;
    visited.add(step.agent);
    for (const dep of step.dependsOn ?? []) {
      const depStep = workflow.find(s => s.agent === dep);
      if (depStep) visit(depStep);
    }
    order.push(step.agent);
  }

  for (const step of workflow) {
    visit(step);
  }

  return order;
}

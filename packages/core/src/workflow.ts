import type { WorkflowName, WorkflowStep } from './types.js';

export const WORKFLOWS: Record<WorkflowName, WorkflowStep[]> = {
  // Static fallback shapes. The runtime uses planAgentLoop() to choose a
  // narrower route per task instead of blindly running every specialist.
  brainstorm: [
    { agent: 'context-retriever' },
    { agent: 'plot-architect', dependsOn: ['context-retriever'] },
  ],

  setting: [
    { agent: 'context-retriever' },
    { agent: 'worldbuilding-agent', dependsOn: ['context-retriever'] },
    { agent: 'continuity-checker', dependsOn: ['worldbuilding-agent'] },
  ],

  chapterWriting: [
    { agent: 'context-retriever' },
    { agent: 'prose-writer', dependsOn: ['context-retriever'] },
    { agent: 'continuity-checker', dependsOn: ['prose-writer'] },
  ],

  polish: [
    { agent: 'context-retriever' },
    { agent: 'style-editor', dependsOn: ['context-retriever'] },
  ],

  continuityCheck: [
    { agent: 'context-retriever' },
    { agent: 'continuity-checker', dependsOn: ['context-retriever'] },
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

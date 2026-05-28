import type {
  AgentLoopPhase,
  AgentLoopPlan,
  AgentLoopPlanningOptions,
  AgentLoopRole,
  AgentLoopStep,
  WorkflowName,
  WritingContextPacket,
} from './types.js';

const OPTIONAL_AGENTS = [
  'plot-architect',
  'character-agent',
  'worldbuilding-agent',
  'style-editor',
  'continuity-checker',
  'critic',
  'memory-curator',
];

const WORKFLOW_LABELS: Record<WorkflowName, string> = {
  brainstorm: 'brainstorm',
  setting: 'setting',
  chapterWriting: 'write',
  polish: 'polish',
  continuityCheck: 'check',
};

export function planAgentLoop(
  workflow: WorkflowName,
  context: WritingContextPacket,
  options: AgentLoopPlanningOptions = {},
): AgentLoopPlan {
  return new LoopPlanner(workflow, context, options).plan();
}

class LoopPlanner {
  private readonly steps: AgentLoopStep[] = [];
  private readonly rationale: string[] = [];
  private readonly selected = new Set<string>();

  constructor(
    private readonly workflow: WorkflowName,
    private readonly context: WritingContextPacket,
    private readonly options: AgentLoopPlanningOptions,
  ) {}

  plan(): AgentLoopPlan {
    this.add('context-retriever', 'observe', 'lead', 'Load project context before the lead agent works.');

    switch (this.workflow) {
      case 'chapterWriting':
        this.add('prose-writer', 'act', 'lead', 'Default writing turns stay with the lead writer; specialists are opt-in.');
        break;
      case 'brainstorm':
        this.add('plot-architect', 'act', 'lead', 'Brainstorming is led by plot architecture unless a narrower command is used.');
        break;
      case 'setting':
        this.add('worldbuilding-agent', 'act', 'lead', 'Setting work is led by the worldbuilding agent.');
        break;
      case 'polish':
        this.add('style-editor', 'act', 'lead', 'Polish is led by the style editor.');
        break;
      case 'continuityCheck':
        this.add('continuity-checker', 'act', 'lead', 'Continuity checking is led by the continuity checker.');
        break;
    }

    this.addRequestedReviewers();

    return {
      workflow: this.workflow,
      task: this.context.task,
      label: WORKFLOW_LABELS[this.workflow],
      steps: this.steps,
      rationale: this.rationale,
      skippedAgents: OPTIONAL_AGENTS.filter(agent => !this.selected.has(agent)),
    };
  }

  private addRequestedReviewers(): void {
    for (const agent of this.options.reviewers ?? []) {
      this.add(agent, 'verify', 'reviewer', 'Explicitly requested reviewer; no automatic specialist fan-out.');
    }
  }

  private add(agent: string, phase: AgentLoopPhase, role: AgentLoopRole, reason: string): void {
    if (this.selected.has(agent)) return;

    const previous = this.steps.at(-1)?.agent;
    this.selected.add(agent);
    this.steps.push({
      agent,
      phase,
      role,
      reason,
      dependsOn: previous ? [previous] : undefined,
    });
    this.rationale.push(`${phase}: ${agent} - ${reason}`);
  }
}

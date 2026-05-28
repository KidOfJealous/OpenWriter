import type {
  AgentLoopPlan,
  AgentLoopPlanningOptions,
  AgentLoopRole,
  AgentLoopPhase,
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
  const maxSpecialists = clamp(options.maxSpecialists ?? 2, 0, 3);
  const planner = new LoopPlanner(workflow, context, maxSpecialists);
  return planner.plan();
}

class LoopPlanner {
  private readonly steps: AgentLoopStep[] = [];
  private readonly rationale: string[] = [];
  private readonly selected = new Set<string>();
  private optionalCount = 0;

  constructor(
    private readonly workflow: WorkflowName,
    private readonly context: WritingContextPacket,
    private readonly maxSpecialists: number,
  ) {}

  plan(): AgentLoopPlan {
    this.add('context-retriever', 'observe', 'lead', 'Load only the relevant canon, drafts, and cache-stable context first.');

    switch (this.workflow) {
      case 'chapterWriting':
        this.planChapterWriting();
        break;
      case 'brainstorm':
        this.planBrainstorm();
        break;
      case 'setting':
        this.planSetting();
        break;
      case 'polish':
        this.planPolish();
        break;
      case 'continuityCheck':
        this.planContinuityCheck();
        break;
    }

    return {
      workflow: this.workflow,
      task: this.context.task,
      label: WORKFLOW_LABELS[this.workflow],
      steps: this.steps,
      rationale: this.rationale,
      skippedAgents: OPTIONAL_AGENTS.filter(agent => !this.selected.has(agent)),
    };
  }

  private planChapterWriting(): void {
    const task = this.context.task;
    const prepAgents: string[] = [];

    if (matches(task, PLAN_KEYWORDS)) {
      if (this.trySpecialist('plot-architect', 'plan', 'Task asks for structure/outline, so pre-plan the plot before drafting.')) {
        prepAgents.push('plot-architect');
      }
    }

    if (matches(task, CHARACTER_KEYWORDS)) {
      if (this.trySpecialist('character-agent', 'plan', 'Task is character-sensitive, so check motivation and relationship constraints.')) {
        prepAgents.push('character-agent');
      }
    }

    if (matches(task, WORLDBUILDING_KEYWORDS)) {
      if (this.trySpecialist('worldbuilding-agent', 'plan', 'Task touches setting/world rules, so validate worldbuilding before drafting.')) {
        prepAgents.push('worldbuilding-agent');
      }
    }

    this.add(
      'prose-writer',
      'act',
      'lead',
      prepAgents.length > 0
        ? 'Write after the focused planning evidence is available.'
        : 'Write directly; no broad specialist fan-out was needed.',
    );

    this.add('continuity-checker', 'verify', 'reviewer', 'Verify the generated draft against canon and deprecated facts.');

    if (matches(task, STYLE_KEYWORDS)) {
      this.trySpecialist('style-editor', 'verify', 'Task explicitly asks for style/polish, so run a style pass after drafting.');
    }

    if (matches(task, REVIEW_KEYWORDS)) {
      this.add('critic', 'summarize', 'reviewer', 'Only run the broad critic because the task explicitly asks for review.');
    }
  }

  private planBrainstorm(): void {
    const task = this.context.task;
    const picked: string[] = [];

    if (matches(task, CHARACTER_KEYWORDS)) {
      picked.push('character-agent');
    }
    if (matches(task, WORLDBUILDING_KEYWORDS)) {
      picked.push('worldbuilding-agent');
    }
    if (matches(task, PLOT_KEYWORDS) || picked.length === 0) {
      picked.unshift('plot-architect');
    }

    for (const agent of unique(picked)) {
      this.trySpecialist(agent, 'act', `Brainstorm scope selected ${agent} instead of running every specialist.`);
    }

    if (matches(task, REVIEW_KEYWORDS)) {
      this.add('critic', 'summarize', 'reviewer', 'Review was requested, so synthesize risks after ideation.');
    }
  }

  private planSetting(): void {
    const task = this.context.task;

    this.add('worldbuilding-agent', 'act', 'lead', 'Setting work has one lead: expand rules, places, factions, or history.');
    this.add('continuity-checker', 'verify', 'reviewer', 'Check the new setting against existing canon before it becomes memory.');

    if (matches(task, MEMORY_KEYWORDS)) {
      this.trySpecialist('memory-curator', 'summarize', 'Task asks to update/organize memory, so curate canon changes.');
    }
  }

  private planPolish(): void {
    const task = this.context.task;

    this.add('style-editor', 'act', 'lead', 'Polish is a style-led pass; avoid plot/character fan-out by default.');

    if (matches(task, CONSISTENCY_KEYWORDS)) {
      this.trySpecialist('continuity-checker', 'verify', 'Task also mentions consistency, so run one continuity verification.');
    }
  }

  private planContinuityCheck(): void {
    const task = this.context.task;

    this.add('continuity-checker', 'act', 'lead', 'Continuity checking has one lead checker over retrieved canon and drafts.');

    if (matches(task, CHARACTER_KEYWORDS)) {
      this.trySpecialist('character-agent', 'verify', 'Character continuity is explicit, so add a focused character verifier.');
    }

    if (matches(task, WORLDBUILDING_KEYWORDS)) {
      this.trySpecialist('worldbuilding-agent', 'verify', 'Worldbuilding consistency is explicit, so add a focused setting verifier.');
    }

    if (matches(task, REVIEW_KEYWORDS)) {
      this.add('critic', 'summarize', 'reviewer', 'Broad review was requested, so summarize priority risks.');
    }
  }

  private trySpecialist(agent: string, phase: AgentLoopPhase, reason: string): boolean {
    if (this.optionalCount >= this.maxSpecialists) {
      this.rationale.push(`Skipped ${agent}: specialist cap ${this.maxSpecialists} already reached.`);
      return false;
    }

    this.optionalCount++;
    this.add(agent, phase, 'specialist', reason);
    return true;
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

function matches(input: string, keywords: readonly string[]): boolean {
  const normalized = input.toLowerCase();
  return keywords.some(keyword => normalized.includes(keyword.toLowerCase()));
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const PLAN_KEYWORDS = [
  'plan',
  'outline',
  'structure',
  'arc',
  '大纲',
  '规划',
  '结构',
  '节奏',
  '剧情',
  '情节',
] as const;

const PLOT_KEYWORDS = [
  'plot',
  'story',
  'conflict',
  'twist',
  '伏笔',
  '反转',
  '冲突',
  '剧情',
  '情节',
] as const;

const CHARACTER_KEYWORDS = [
  'character',
  'relationship',
  'motivation',
  '人物',
  '角色',
  '动机',
  '关系',
  '弧线',
] as const;

const WORLDBUILDING_KEYWORDS = [
  'world',
  'setting',
  'lore',
  'faction',
  'rule',
  '设定',
  '世界观',
  '势力',
  '规则',
  '地点',
  '历史',
] as const;

const STYLE_KEYWORDS = [
  'style',
  'polish',
  'revise',
  'prose',
  '润色',
  '文风',
  '改写',
  '修订',
  '语言',
] as const;

const CONSISTENCY_KEYWORDS = [
  'continuity',
  'consistency',
  'canon',
  'timeline',
  '连续性',
  '一致',
  '设定',
  '时间线',
  '冲突',
] as const;

const REVIEW_KEYWORDS = [
  'review',
  'audit',
  'critic',
  'critique',
  '检查',
  '评审',
  '审稿',
  '风险',
  '问题',
] as const;

const MEMORY_KEYWORDS = [
  'memory',
  'canon',
  'record',
  'index',
  '记忆',
  '设定集',
  '正史',
  '归档',
  '整理',
  '记录',
] as const;

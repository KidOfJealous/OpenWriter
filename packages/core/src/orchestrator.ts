import type {
  WritingAgent,
  WritingContextPacket,
  AgentResult,
  AgentOptions,
  WorkflowName,
  WorkflowStep,
} from './types.js';
import { WORKFLOWS, resolveWorkflowOrder } from './workflow.js';

export class Orchestrator {
  private agents = new Map<string, WritingAgent>();

  register(agent: WritingAgent) {
    this.agents.set(agent.name, agent);
  }

  getAgent(name: string): WritingAgent | undefined {
    return this.agents.get(name);
  }

  listAgents(): string[] {
    return Array.from(this.agents.keys());
  }

  async executeWorkflow(
    workflowName: WorkflowName,
    context: WritingContextPacket,
    options?: AgentOptions,
  ): Promise<Record<string, AgentResult>> {
    const workflow = WORKFLOWS[workflowName];
    if (!workflow) throw new Error(`Unknown workflow: ${workflowName}`);

    return this.executePipeline(workflow, context, options);
  }

  async executeCustomPipeline(
    steps: WorkflowStep[],
    context: WritingContextPacket,
    options?: AgentOptions,
  ): Promise<Record<string, AgentResult>> {
    return this.executePipeline(steps, context, options);
  }

  private async executePipeline(
    steps: WorkflowStep[],
    initialContext: WritingContextPacket,
    options?: AgentOptions,
  ): Promise<Record<string, AgentResult>> {
    const order = resolveWorkflowOrder(steps);
    const results: Record<string, AgentResult> = {};

    for (const agentName of order) {
      const agent = this.agents.get(agentName);
      if (!agent) throw new Error(`Agent not registered: ${agentName}`);

      const step = steps.find(s => s.agent === agentName);
      const context = step?.inputTransform
        ? step.inputTransform(results)
        : initialContext;

      console.log(`[Orchestrator] Running: ${agentName}`);
      const result = await agent.execute(context, options);
      results[agentName] = result;
    }

    return results;
  }
}

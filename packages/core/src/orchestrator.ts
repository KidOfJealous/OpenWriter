import type {
  WritingAgent,
  WritingContextPacket,
  AgentResult,
  AgentOptions,
  WorkflowName,
  WorkflowStep,
  AggressiveCachePolicy,
} from './types.js';
import { AggressiveCacheManager } from './cache.js';
import { WORKFLOWS, resolveWorkflowOrder } from './workflow.js';
import { planAgentLoop } from './agent-loop.js';

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

    return this.executePipeline(planAgentLoop(workflowName, context).steps, context, options);
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
    const cachePolicy = this.resolveCachePolicy(initialContext, options);
    const cache = new AggressiveCacheManager(cachePolicy);
    const observer = options?.observer;
    let workingContext = cache.stabilizeContextPacket(initialContext);
    cache.prime(workingContext);

    for (const [index, agentName] of order.entries()) {
      const agent = this.agents.get(agentName);
      if (!agent) throw new Error(`Agent not registered: ${agentName}`);

      const step = steps.find(s => s.agent === agentName);
      const baseContext = step?.inputTransform
        ? cache.stabilizeContextPacket(step.inputTransform(results))
        : workingContext;
      const context = cache.prepareForAgent(baseContext);

      if (!options?.quiet) {
        console.log(`[Orchestrator] Running: ${agentName}`);
      }
      observer?.onAgentStart?.({
        agent: agentName,
        index,
        total: order.length,
        context,
      });

      const startedAt = Date.now();
      let result: AgentResult;
      try {
        result = await agent.execute(context, {
          ...options,
          model: this.resolveAgentModel(agentName, options),
        });
      } catch (error) {
        observer?.onAgentError?.({
          agent: agentName,
          index,
          total: order.length,
          context,
          durationMs: Date.now() - startedAt,
          error,
        });
        throw error;
      }
      cache.appendResult(agentName, result);
      result.metadata = {
        ...result.metadata,
        cache: cache.getSnapshot(context),
        workflowLog: cache.getWorkflowLog(),
      };
      observer?.onAgentComplete?.({
        agent: agentName,
        index,
        total: order.length,
        context,
        result,
        durationMs: Date.now() - startedAt,
      });
      results[agentName] = result;

      const packet = this.extractContextPacket(result);
      if (packet) {
        workingContext = cache.stabilizeContextPacket(packet);
      } else if (!step?.inputTransform) {
        workingContext = cache.stabilizeContextPacket(
          this.mergeGeneratedDraft(context, agentName, result),
        );
      }
    }

    return results;
  }

  private resolveCachePolicy(
    context: WritingContextPacket,
    options?: AgentOptions,
  ): Partial<AggressiveCachePolicy> | undefined {
    const optionPolicy = options?.cachePolicy;
    if (optionPolicy && typeof optionPolicy === 'object' && !Array.isArray(optionPolicy)) {
      return {
        ...context.projectProfile.cache,
        ...(optionPolicy as Partial<AggressiveCachePolicy>),
      };
    }

    return context.projectProfile.cache;
  }

  private resolveAgentModel(agentName: string, options?: AgentOptions): string | undefined {
    return options?.agentModels?.[agentName] ?? options?.model;
  }

  private extractContextPacket(result: AgentResult): WritingContextPacket | null {
    const content = result.content;
    if (!content || typeof content !== 'object' || Array.isArray(content)) return null;

    const maybePacket = (content as { packet?: unknown }).packet;
    if (this.isWritingContextPacket(maybePacket)) return maybePacket;
    if (this.isWritingContextPacket(content)) return content;

    return null;
  }

  private isWritingContextPacket(value: unknown): value is WritingContextPacket {
    if (!value || typeof value !== 'object') return false;
    const packet = value as Partial<WritingContextPacket>;
    return typeof packet.task === 'string'
      && !!packet.projectProfile
      && Array.isArray(packet.relevantCanon)
      && Array.isArray(packet.relevantDrafts)
      && Array.isArray(packet.deprecatedItems)
      && Array.isArray(packet.constraints);
  }

  private mergeGeneratedDraft(
    context: WritingContextPacket,
    agentName: string,
    result: AgentResult,
  ): WritingContextPacket {
    if (agentName !== 'prose-writer' || result.type !== 'text' || typeof result.content !== 'string') {
      return context;
    }

    return {
      ...context,
      relevantDrafts: [
        {
          source: `workflow:${agentName}`,
          content: result.content,
        },
        ...context.relevantDrafts,
      ],
    };
  }
}

import { createHash } from 'crypto';
import type {
  AgentResult,
  AggressiveCachePolicy,
  CacheSnapshot,
  CanonEntry,
  DraftEntry,
  WritingContextPacket,
  WorkflowLogEntry,
} from './types.js';

export const DEFAULT_AGGRESSIVE_CACHE_POLICY: AggressiveCachePolicy = {
  enabled: true,
  strategy: 'aggressive',
  stablePrefix: true,
  appendOnlyWorkflowLog: true,
  maxCanonEntries: 32,
  maxDraftEntries: 8,
  maxCanonEntryChars: 4000,
  maxDraftEntryChars: 12000,
  maxWorkflowLogEntries: 12,
  maxResultChars: 1800,
  maxTotalContextChars: 120000,
};

export function resolveAggressiveCachePolicy(
  policy?: Partial<AggressiveCachePolicy>,
): AggressiveCachePolicy {
  return {
    ...DEFAULT_AGGRESSIVE_CACHE_POLICY,
    ...policy,
    enabled: policy?.enabled ?? DEFAULT_AGGRESSIVE_CACHE_POLICY.enabled,
    strategy: policy?.strategy ?? DEFAULT_AGGRESSIVE_CACHE_POLICY.strategy,
  };
}

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortStable(value));
}

export function approximateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

export class AggressiveCacheManager {
  private readonly policy: AggressiveCachePolicy;
  private immutablePrefix = '';
  private workflowLog: WorkflowLogEntry[] = [];

  constructor(policy?: Partial<AggressiveCachePolicy>) {
    this.policy = resolveAggressiveCachePolicy(policy);
  }

  prime(context: WritingContextPacket): void {
    this.immutablePrefix = this.buildImmutablePrefix(context);
  }

  prepareForAgent(context: WritingContextPacket): WritingContextPacket {
    if (!this.policy.enabled) return context;
    if (!this.immutablePrefix) this.prime(context);

    const stabilized = this.stabilizeContextPacket(context);
    const workflowLog = this.policy.appendOnlyWorkflowLog
      ? this.workflowLog.slice(-this.policy.maxWorkflowLogEntries)
      : [];

    const withLog: WritingContextPacket = {
      ...stabilized,
      workflowLog,
    };

    return {
      ...withLog,
      cache: this.buildSnapshot(withLog),
    };
  }

  stabilizeContextPacket(context: WritingContextPacket): WritingContextPacket {
    if (!this.policy.enabled) return context;

    const { relevantCanon, relevantDrafts } = this.enforceTotalContextLimit(
      this.limitCanon(context.relevantCanon),
      this.limitDrafts(context.relevantDrafts),
    );

    return {
      ...context,
      relevantCanon,
      relevantDrafts,
      workflowLog: context.workflowLog?.slice(-this.policy.maxWorkflowLogEntries),
    };
  }

  appendResult(agent: string, result: AgentResult): WorkflowLogEntry | null {
    if (!this.policy.enabled || !this.policy.appendOnlyWorkflowLog) return null;

    const content = this.distillResult(result);
    const entry: WorkflowLogEntry = {
      index: this.workflowLog.length + 1,
      agent,
      type: result.type,
      content,
      contentHash: hashText(content),
    };

    this.workflowLog.push(entry);
    if (this.workflowLog.length > this.policy.maxWorkflowLogEntries) {
      this.workflowLog = this.workflowLog.slice(-this.policy.maxWorkflowLogEntries);
    }

    return entry;
  }

  getSnapshot(context: WritingContextPacket): CacheSnapshot {
    return this.buildSnapshot(context);
  }

  private buildImmutablePrefix(context: WritingContextPacket): string {
    const prefix = {
      projectProfile: context.projectProfile,
      constraints: context.constraints,
      openQuestions: context.openQuestions,
    };

    return stableStringify(prefix);
  }

  private buildSnapshot(context: WritingContextPacket): CacheSnapshot {
    const contextText = stableStringify({
      projectProfile: context.projectProfile,
      relevantCanon: context.relevantCanon,
      relevantDrafts: context.relevantDrafts,
      deprecatedItems: context.deprecatedItems,
      workflowLog: context.workflowLog,
      constraints: context.constraints,
    });

    const workflowLogText = stableStringify(context.workflowLog ?? []);

    return {
      strategy: this.policy.strategy,
      immutablePrefixHash: hashText(this.immutablePrefix),
      immutablePrefixChars: this.immutablePrefix.length,
      workflowLogChars: workflowLogText.length,
      approxContextTokens: approximateTokens(contextText),
      trimmed: {
        canonEntries: context.relevantCanon.length,
        draftEntries: context.relevantDrafts.length,
        workflowLogEntries: context.workflowLog?.length ?? 0,
      },
    };
  }

  private limitCanon(entries: CanonEntry[]): CanonEntry[] {
    const seen = new Set<string>();
    const deduped: CanonEntry[] = [];

    for (const entry of entries) {
      const key = `${entry.source}:${hashText(entry.content)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push({
        ...entry,
        content: limitText(entry.content, this.policy.maxCanonEntryChars),
      });
    }

    const limited = deduped.slice(0, this.policy.maxCanonEntries);
    if (!this.policy.stablePrefix) return limited;

    return [...limited].sort(compareBySource);
  }

  private limitDrafts(entries: DraftEntry[]): DraftEntry[] {
    const seen = new Set<string>();
    const deduped: DraftEntry[] = [];

    for (const entry of entries) {
      const key = `${entry.source}:${hashText(entry.content)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push({
        ...entry,
        content: limitText(entry.content, this.policy.maxDraftEntryChars),
      });
    }

    return deduped.slice(0, this.policy.maxDraftEntries);
  }

  private enforceTotalContextLimit(
    relevantCanon: CanonEntry[],
    relevantDrafts: DraftEntry[],
  ): { relevantCanon: CanonEntry[]; relevantDrafts: DraftEntry[] } {
    const totalChars = sumContentChars(relevantCanon) + sumContentChars(relevantDrafts);
    if (totalChars <= this.policy.maxTotalContextChars) {
      return { relevantCanon, relevantDrafts };
    }

    const canonBudget = Math.floor(this.policy.maxTotalContextChars * 0.45);
    const draftBudget = this.policy.maxTotalContextChars - canonBudget;

    return {
      relevantCanon: limitEntriesByBudget(relevantCanon, canonBudget),
      relevantDrafts: limitEntriesByBudget(relevantDrafts, draftBudget),
    };
  }

  private distillResult(result: AgentResult): string {
    const content = typeof result.content === 'string'
      ? result.content
      : stableStringify(result.content);

    return limitText(content, this.policy.maxResultChars);
  }
}

function limitText(text: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  const headChars = Math.floor(maxChars * 0.72);
  const tailChars = maxChars - headChars;
  return `${text.slice(0, headChars)}\n\n[...cache-trimmed:${text.length - maxChars} chars...]\n\n${text.slice(-tailChars)}`;
}

function limitEntriesByBudget<T extends { content: string }>(entries: T[], budget: number): T[] {
  const limited: T[] = [];
  let remaining = budget;

  for (const entry of entries) {
    if (remaining <= 0) break;
    const content = entry.content.length <= remaining
      ? entry.content
      : limitText(entry.content, remaining);
    limited.push({ ...entry, content });
    remaining -= content.length;
  }

  return limited;
}

function sumContentChars(entries: Array<{ content: string }>): number {
  return entries.reduce((total, entry) => total + entry.content.length, 0);
}

function compareBySource(a: { source: string }, b: { source: string }): number {
  return a.source.localeCompare(b.source);
}

function sortStable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortStable);
  if (!value || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};

  for (const key of Object.keys(record).sort()) {
    const item = record[key];
    if (item !== undefined) sorted[key] = sortStable(item);
  }

  return sorted;
}

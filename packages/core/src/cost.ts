import type {
  AgentResult,
  ModelPricing,
  ProviderUsage,
  UsageCostEstimate,
  UsageCostSummary,
} from './types.js';

export const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  'deepseek-chat': {
    provider: 'deepseek',
    model: 'deepseek-chat',
    currency: 'USD',
    inputCacheHitUsdPerMillion: 0.0028,
    inputCacheMissUsdPerMillion: 0.14,
    outputUsdPerMillion: 0.28,
  },
  'deepseek-reasoner': {
    provider: 'deepseek',
    model: 'deepseek-reasoner',
    currency: 'USD',
    inputCacheHitUsdPerMillion: 0.0028,
    inputCacheMissUsdPerMillion: 0.14,
    outputUsdPerMillion: 0.28,
  },
  'deepseek-v4-flash': {
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    currency: 'USD',
    inputCacheHitUsdPerMillion: 0.0028,
    inputCacheMissUsdPerMillion: 0.14,
    outputUsdPerMillion: 0.28,
  },
  'deepseek-v4-pro': {
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    currency: 'USD',
    inputCacheHitUsdPerMillion: 0.003625,
    inputCacheMissUsdPerMillion: 0.435,
    outputUsdPerMillion: 0.87,
  },
};

export function estimateUsageCost(
  agent: string,
  usage: ProviderUsage,
  model: string,
  pricingTable: Record<string, ModelPricing> = DEFAULT_MODEL_PRICING,
): UsageCostEstimate {
  const normalizedModel = normalizeModelName(model);
  const pricing = pricingTable[normalizedModel];
  const promptTokens = usage.promptTokens ?? (
    usage.promptCacheHitTokens ?? 0
  ) + (
    usage.promptCacheMissTokens ?? 0
  );
  const completionTokens = usage.completionTokens ?? Math.max(
    0,
    (usage.totalTokens ?? 0) - promptTokens,
  );
  const cacheHitTokens = usage.promptCacheHitTokens ?? 0;
  const cacheMissTokens = usage.promptCacheMissTokens ?? Math.max(0, promptTokens - cacheHitTokens);
  const cacheInputTokens = cacheHitTokens + cacheMissTokens;
  const cacheHitRate = cacheInputTokens > 0
    ? cacheHitTokens / cacheInputTokens
    : undefined;

  if (!pricing) {
    return {
      agent,
      model: normalizedModel,
      usage,
      promptTokens,
      completionTokens,
      cacheHitTokens,
      cacheMissTokens,
      cacheHitRate,
    };
  }

  const inputUsd = (
    cacheHitTokens * pricing.inputCacheHitUsdPerMillion
    + cacheMissTokens * pricing.inputCacheMissUsdPerMillion
  ) / 1_000_000;
  const outputUsd = completionTokens * pricing.outputUsdPerMillion / 1_000_000;
  const estimatedUsd = inputUsd + outputUsd;
  const uncachedEstimatedUsd = (
    cacheInputTokens * pricing.inputCacheMissUsdPerMillion
    + completionTokens * pricing.outputUsdPerMillion
  ) / 1_000_000;

  return {
    agent,
    model: normalizedModel,
    usage,
    pricing,
    promptTokens,
    completionTokens,
    cacheHitTokens,
    cacheMissTokens,
    cacheHitRate,
    estimatedUsd,
    uncachedEstimatedUsd,
    estimatedSavingsUsd: Math.max(0, uncachedEstimatedUsd - estimatedUsd),
  };
}

export function summarizeUsageCosts(
  results: Record<string, AgentResult>,
  fallbackModel = 'deepseek-chat',
  pricingTable: Record<string, ModelPricing> = DEFAULT_MODEL_PRICING,
): UsageCostSummary {
  const estimates = Object.entries(results)
    .map(([agent, result]) => {
      const usage = getProviderUsage(result);
      if (!usage) return null;
      const model = getResultModel(result) ?? fallbackModel;
      return estimateUsageCost(agent, usage, model, pricingTable);
    })
    .filter((estimate): estimate is UsageCostEstimate => estimate !== null);

  const summary: UsageCostSummary = {
    estimates,
    promptTokens: sum(estimates, item => item.promptTokens),
    completionTokens: sum(estimates, item => item.completionTokens),
    cacheHitTokens: sum(estimates, item => item.cacheHitTokens),
    cacheMissTokens: sum(estimates, item => item.cacheMissTokens),
  };

  const cacheInputTokens = summary.cacheHitTokens + summary.cacheMissTokens;
  if (cacheInputTokens > 0) {
    summary.cacheHitRate = summary.cacheHitTokens / cacheInputTokens;
  }

  const priced = estimates.filter(item => item.estimatedUsd !== undefined);
  if (priced.length > 0) {
    summary.estimatedUsd = sum(priced, item => item.estimatedUsd ?? 0);
    summary.uncachedEstimatedUsd = sum(priced, item => item.uncachedEstimatedUsd ?? 0);
    summary.estimatedSavingsUsd = sum(priced, item => item.estimatedSavingsUsd ?? 0);
  }

  return summary;
}

function normalizeModelName(model: string): string {
  return model.trim().toLowerCase();
}

function getResultModel(result: AgentResult): string | undefined {
  const metadata = result.metadata;
  const model = metadata?.model;
  return typeof model === 'string' ? model : undefined;
}

function getProviderUsage(result: AgentResult): ProviderUsage | null {
  const metadata = result.metadata;
  const usage = metadata?.providerUsage;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const candidate = usage as ProviderUsage;
  if (
    candidate.promptTokens === undefined
    && candidate.completionTokens === undefined
    && candidate.totalTokens === undefined
    && candidate.promptCacheHitTokens === undefined
    && candidate.promptCacheMissTokens === undefined
  ) {
    return null;
  }
  return candidate;
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}

import { describe, it, expect } from 'vitest';
import { estimateUsageCost, summarizeUsageCosts } from '../src/cost';

describe('usage cost', () => {
  it('estimates DeepSeek cached prompt cost and savings', () => {
    const estimate = estimateUsageCost(
      'writer',
      {
        promptTokens: 1200,
        completionTokens: 300,
        promptCacheHitTokens: 900,
        promptCacheMissTokens: 300,
      },
      'deepseek-v4-flash',
    );

    expect(estimate.cacheHitRate).toBeCloseTo(0.75);
    expect(estimate.estimatedUsd).toBeGreaterThan(0);
    expect(estimate.estimatedSavingsUsd).toBeGreaterThan(0);
  });

  it('summarizes result metadata usage', () => {
    const summary = summarizeUsageCosts({
      retriever: {
        type: 'json',
        content: {},
      },
      writer: {
        type: 'text',
        content: 'text',
        metadata: {
          model: 'deepseek-v4-flash',
          providerUsage: {
            promptTokens: 1000,
            completionTokens: 500,
            promptCacheHitTokens: 250,
            promptCacheMissTokens: 750,
          },
        },
      },
    });

    expect(summary.estimates).toHaveLength(1);
    expect(summary.promptTokens).toBe(1000);
    expect(summary.completionTokens).toBe(500);
    expect(summary.cacheHitRate).toBeCloseTo(0.25);
  });
});

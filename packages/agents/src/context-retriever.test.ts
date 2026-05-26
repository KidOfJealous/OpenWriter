import { describe, it, expect } from 'vitest';
import { ContextRetriever } from '../src/context-retriever';

describe('context-retriever', () => {
  const retriever = new ContextRetriever();

  it('tokenizes Chinese text correctly', () => {
    const tokenize = (retriever as any).tokenize.bind(retriever);
    const terms = tokenize('林渊调查案件');
    expect(terms).toContain('林');
    expect(terms).toContain('渊');
    expect(terms).toContain('林渊');
    expect(terms).toContain('调查');
  });

  it('tokenizes English text correctly', () => {
    const tokenize = (retriever as any).tokenize.bind(retriever);
    const terms = tokenize('Hello World');
    expect(terms).toContain('hello');
    expect(terms).toContain('world');
  });

  it('scores exact match correctly', () => {
    const score = (retriever as any).exactMatchScore.bind(retriever);
    expect(score(['林渊', '调查'], ['林渊', '调查', '案件'])).toBe(1);
    expect(score(['林渊', '调查'], ['林渊', '吃饭'])).toBe(0.5);
    expect(score(['林渊', '调查'], ['吃饭', '睡觉'])).toBe(0);
    expect(score([], ['林渊'])).toBe(0);
  });
});

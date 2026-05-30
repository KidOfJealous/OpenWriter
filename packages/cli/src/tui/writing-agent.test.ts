import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import type { LLMProvider, Message, ProviderUsage, ToolChatResponse, ToolDefinition } from '@openwriter/core';
import { isExplicitWriteRequest, runWritingAgentTurn } from './writing-agent.js';

class ScriptedProvider implements LLMProvider {
  name = 'scripted';
  private index = 0;

  constructor(private readonly responses: ToolChatResponse[]) {}

  async chat(): Promise<string> {
    throw new Error('not used');
  }

  async chatJson<T>(): Promise<T> {
    throw new Error('not used');
  }

  async chatWithTools(_messages: Message[], _tools: ToolDefinition[]): Promise<ToolChatResponse> {
    const response = this.responses[this.index];
    this.index += 1;
    if (!response) throw new Error('no scripted response');
    return response;
  }

  getLastUsage(): ProviderUsage | undefined {
    return undefined;
  }
}

describe('writing agent loop', () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it('keeps check-like turns read-only even if a model asks for edit_file', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'openwriter-agent-'));
    const file = join(tempDir, 'setting.md');
    writeFileSync(file, 'old setting\n', 'utf-8');

    const provider = new ScriptedProvider([
      {
        content: '',
        toolCalls: [{
          id: 'call_1',
          type: 'function',
          function: {
            name: 'edit_file',
            arguments: JSON.stringify({
              path: 'setting.md',
              old_text: 'old setting',
              new_text: 'new setting',
            }),
          },
          parsedArguments: {
            path: 'setting.md',
            old_text: 'old setting',
            new_text: 'new setting',
          },
        }],
      },
      {
        content: 'I cannot edit files during a read-only check.',
        toolCalls: [],
      },
    ]);

    const result = await runWritingAgentTurn({
      provider,
      workDir: tempDir,
      task: '检查设定有没有矛盾',
      allowWrites: false,
    });

    expect(result.content).toContain('read-only');
    expect(result.diffs).toEqual([]);
    expect(readFileSync(file, 'utf-8')).toBe('old setting\n');
  });

  it('requires reading an existing file before write_file can overwrite it', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'openwriter-agent-'));
    const file = join(tempDir, 'draft.md');
    writeFileSync(file, 'old draft\n', 'utf-8');

    const provider = new ScriptedProvider([
      {
        content: '',
        toolCalls: [{
          id: 'call_1',
          type: 'function',
          function: {
            name: 'write_file',
            arguments: JSON.stringify({ path: 'draft.md', content: 'new draft\n' }),
          },
          parsedArguments: { path: 'draft.md', content: 'new draft\n' },
        }],
      },
      {
        content: 'I need to read the file first before overwriting it.',
        toolCalls: [],
      },
    ]);

    const result = await runWritingAgentTurn({
      provider,
      workDir: tempDir,
      task: '改一下 draft.md',
      allowWrites: true,
    });

    expect(result.content).toContain('read');
    expect(result.diffs).toEqual([]);
    expect(readFileSync(file, 'utf-8')).toBe('old draft\n');
  });

  it('recognizes explicit Chinese write requests as write permission, not routing', () => {
    expect(isExplicitWriteRequest('检查时间线')).toBe(false);
    expect(isExplicitWriteRequest('把这一章润色一下')).toBe(true);
    expect(isExplicitWriteRequest('续写下一段并保存')).toBe(true);
  });
});

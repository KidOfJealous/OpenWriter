import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import type { LLMProvider, Message, ProviderUsage, ToolChatResponse, ToolDefinition } from '@openwriter/core';
import { runWritingAgentTurn } from './writing-agent.js';

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

  it('saves canon entries into OpenWriter managed memory instead of a user canon directory', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'openwriter-agent-'));

    const provider = new ScriptedProvider([
      {
        content: '',
        toolCalls: [{
          id: 'call_1',
          type: 'function',
          function: {
            name: 'save_canon',
            arguments: JSON.stringify({
              file: 'characters/林上',
              status: 'canon',
              category: 'character',
              content: '林上习惯在压力下保持沉默。',
            }),
          },
          parsedArguments: {
            file: 'characters/林上',
            status: 'canon',
            category: 'character',
            content: '林上习惯在压力下保持沉默。',
          },
        }],
      },
      {
        content: 'Saved.',
        toolCalls: [],
      },
    ]);

    const result = await runWritingAgentTurn({
      provider,
      workDir: tempDir,
      task: '记住林上的人物设定',
      allowWrites: true,
    });

    const memory = readFileSync(join(tempDir, '.openwriter', 'memory', 'characters', '林上.md'), 'utf-8');
    expect(result.content).toBe('Saved.');
    expect(memory).toContain('status: canon');
    expect(memory).toContain('category: character');
    expect(memory).toContain('林上习惯在压力下保持沉默。');
  });
});

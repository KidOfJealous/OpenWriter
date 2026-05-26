import type {
  WritingAgent,
  WritingContextPacket,
  AgentResult,
  AgentOptions,
} from '@openwriter/core';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export class PatchAgent implements WritingAgent {
  name = 'patch-agent';
  description = '把修改转成 diff 或 SEARCH/REPLACE，保证可审查、可回滚';

  async execute(context: WritingContextPacket, options?: AgentOptions & { targetFile?: string; newContent?: string }): Promise<AgentResult> {
    const targetFile = options?.targetFile ?? context.relevantDrafts[0]?.source;
    const newContent = options?.newContent;

    if (!targetFile) {
      return {
        type: 'text',
        content: 'No target file specified.',
      };
    }

    let originalContent = '';
    if (existsSync(resolve(process.cwd(), targetFile))) {
      originalContent = readFileSync(resolve(process.cwd(), targetFile), 'utf-8');
    }

    const content = newContent ?? context.relevantDrafts[0]?.content ?? '';

    if (!originalContent) {
      return {
        type: 'diff',
        content: `--- /dev/null\n+++ ${targetFile}\n@@ -0,0 +1,${content.split('\n').length} @@\n${content.split('\n').map(l => '+' + l).join('\n')}`,
        metadata: { targetFile, isCreate: true },
      };
    }

    if (originalContent === content) {
      return {
        type: 'diff',
        content: '',
        metadata: { targetFile, hasChanges: false },
      };
    }

    const diff = this.generateDiff(originalContent, content, targetFile);

    return {
      type: 'diff',
      content: diff,
      metadata: { targetFile, hasChanges: true },
    };
  }

  private generateDiff(original: string, modified: string, filePath: string): string {
    const origLines = original.split('\n');
    const modLines = modified.split('\n');

    // Simple line-based diff
    const changes: string[] = [];
    const maxLen = Math.max(origLines.length, modLines.length);

    let origIdx = 0;
    let modIdx = 0;

    while (origIdx < origLines.length || modIdx < modLines.length) {
      if (origIdx >= origLines.length) {
        changes.push('+' + modLines[modIdx]);
        modIdx++;
      } else if (modIdx >= modLines.length) {
        changes.push('-' + origLines[origIdx]);
        origIdx++;
      } else if (origLines[origIdx] === modLines[modIdx]) {
        changes.push(' ' + origLines[origIdx]);
        origIdx++;
        modIdx++;
      } else {
        // Check if it's a simple replacement
        changes.push('-' + origLines[origIdx]);
        changes.push('+' + modLines[modIdx]);
        origIdx++;
        modIdx++;
      }
    }

    return `--- ${filePath}\n+++ ${filePath}\n@@ -1,${origLines.length} +1,${modLines.length} @@\n${changes.join('\n')}`;
  }
}

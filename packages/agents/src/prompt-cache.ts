import type { WritingContextPacket } from '@openwriter/core';

export function formatWorkflowLog(context: WritingContextPacket): string {
  if (!context.workflowLog?.length) return '';

  const lines = context.workflowLog.map(entry => {
    return `#${entry.index} ${entry.agent} (${entry.type}, ${entry.contentHash})\n${entry.content}`;
  });

  return `\n\n【工作流日志（只追加缓存）】\n${lines.join('\n\n')}`;
}

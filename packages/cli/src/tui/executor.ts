import { Orchestrator, summarizeUsageCosts } from '@openwriter/core';
import {
  ContextRetriever,
  ProseWriter,
  ContinuityChecker,
  Critic,
  MemoryCurator,
  CharacterAgent,
  PlotArchitect,
  WorldbuildingAgent,
  StyleEditor,
  PatchAgent,
} from '@openwriter/agents';
import { FileSystemConnector } from '@openwriter/connectors';
import type { AgentResult, WritingContextPacket, StyleProfile } from '@openwriter/core';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { AgentStatus } from './StatusBar.js';

export interface CommandResult {
  output: string;
  duration: number;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    cost?: number;
  };
}

export interface ExecutorOptions {
  model?: string;
}

export async function executeCommand(
  command: string,
  input: string,
  onStatusUpdate?: (statuses: AgentStatus[]) => void,
  options?: ExecutorOptions
): Promise<CommandResult> {
  const startTime = Date.now();
  
  // Handle init command specially
  if (command === 'init') {
    const connector = new FileSystemConnector();
    const config = connector.initProject(input || undefined);
    return {
      output: `已初始化项目: ${config.project.name}\n配置文件: openwriter.yaml\nCanon目录: ${config.project.sourceOfTruth.join(', ')}\nDraft目录: ${config.project.draftDirs.join(', ')}`,
      duration: Date.now() - startTime,
    };
  }

  // Build context for other commands
  const { orchestrator, context } = await buildContext(input);
  if (!context) {
    return {
      output: '未找到 openwriter.yaml。请先运行 init 命令。',
      duration: Date.now() - startTime,
    };
  }

  // Map commands to workflows
  const workflowMap: Record<string, import('@openwriter/core').WorkflowName> = {
    write: 'chapterWriting',
    revise: 'polish',
    check: 'continuityCheck',
    style: 'polish',
    brainstorm: 'brainstorm',
    plan: 'chapterWriting',
  };

  const workflow = workflowMap[command] ?? 'chapterWriting';

  // Update status before execution
  onStatusUpdate?.([
    { name: 'context-retriever', status: 'pending' },
    { name: 'prose-writer', status: 'pending' },
    { name: 'continuity-checker', status: 'pending' },
    { name: 'critic', status: 'pending' },
  ]);

  // Execute workflow
  const results = await orchestrator.executeWorkflow(workflow, context, {
    model: options?.model,
  });

  // Update status after execution
  const finalStatuses: AgentStatus[] = Object.entries(results).map(([name, result]) => ({
    name,
    status: result ? 'completed' : 'error',
    message: result ? undefined : '无结果',
  }));
  onStatusUpdate?.(finalStatuses);

  // Format output based on command
  const output = formatOutput(command, results);

  // Get usage summary
  const usage = summarizeUsageCosts(results, options?.model ?? 'deepseek-chat');

  return {
    output,
    duration: Date.now() - startTime,
    usage: {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      cost: usage.estimatedUsd,
    },
  };
}

function formatOutput(command: string, results: Record<string, AgentResult>): string {
  const sections: string[] = [];

  // Writer output
  const writerResult = results['prose-writer'];
  if (writerResult?.type === 'text' && writerResult.content) {
    sections.push('=== 生成的内容 ===\n' + (writerResult.content as string));
  }

  // Continuity check
  const checkResult = results['continuity-checker'];
  if (checkResult?.content) {
    const issues = checkResult.content as Array<{ severity: string; description: string }>;
    if (issues.length > 0) {
      sections.push('=== 连续性检查 ===\n' + issues.map(i => `[${i.severity}] ${i.description}`).join('\n'));
    } else {
      sections.push('=== 连续性检查 ===\n无问题发现');
    }
  }

  // Critic
  const criticResult = results['critic'];
  if (criticResult?.content) {
    const items = criticResult.content as Array<{ priority: string; dimension: string; description: string }>;
    if (items.length > 0) {
      sections.push('=== 批评 ===\n' + items.map(i => `[${i.priority}] (${i.dimension}) ${i.description}`).join('\n'));
    }
  }

  // Plot architect
  const plotResult = results['plot-architect'];
  if (plotResult?.content) {
    const items = plotResult.content as Array<{ issue: string; severity: string; suggestion: string }>;
    if (items.length > 0) {
      sections.push('=== 剧情分析 ===\n' + items.map(i => `[${i.severity}] ${i.issue}\n  → ${i.suggestion}`).join('\n'));
    }
  }

  // Character agent
  const charResult = results['character-agent'];
  if (charResult?.content) {
    const chars = charResult.content as Array<{ name: string; wants: string; fears: string; arcChange: string }>;
    if (chars.length > 0) {
      sections.push('=== 角色分析 ===\n' + chars.map(c => `${c.name}: 想要${c.wants} / 害怕${c.fears} / 弧线: ${c.arcChange}`).join('\n'));
    }
  }

  // Style editor
  const styleResult = results['style-editor'];
  if (styleResult?.content) {
    const items = styleResult.content as Array<{ type: string; line: string; issue: string; suggestion: string }>;
    if (items.length > 0) {
      sections.push('=== 风格检查 ===\n' + items.map(i => `[${i.type}] "${i.line}"\n  → ${i.suggestion}`).join('\n'));
    } else {
      sections.push('=== 风格检查 ===\n无风格问题');
    }
  }

  // Worldbuilding
  const worldResult = results['worldbuilding-agent'];
  if (worldResult?.content) {
    if (typeof worldResult.content === 'string') {
      sections.push('=== 世界观构建 ===\n' + worldResult.content);
    } else {
      sections.push('=== 世界观构建 ===\n' + JSON.stringify(worldResult.content, null, 2));
    }
  }

  return sections.join('\n\n') || '执行完成，无输出';
}

async function buildContext(task: string, extraContent?: string) {
  const orchestrator = new Orchestrator();

  // Register agents
  orchestrator.register(new ContextRetriever());
  orchestrator.register(new ProseWriter());
  orchestrator.register(new ContinuityChecker());
  orchestrator.register(new Critic());
  orchestrator.register(new MemoryCurator());
  orchestrator.register(new CharacterAgent());
  orchestrator.register(new PlotArchitect());
  orchestrator.register(new WorldbuildingAgent());
  orchestrator.register(new StyleEditor());
  orchestrator.register(new PatchAgent());

  // Load project config
  const connector = new FileSystemConnector();
  const config = connector.readConfig();

  if (!config) {
    return { orchestrator, context: null };
  }

  const contextPacket: WritingContextPacket = {
    task: task ?? '继续写作',
    projectProfile: {
      name: config.project.name,
      language: config.project.language,
      genre: config.project.genre,
      sourceOfTruth: config.project.sourceOfTruth,
      draftDirs: config.project.draftDirs,
      style: config.style as StyleProfile,
      memory: config.memory,
      retrieval: config.retrieval,
      cache: config.cache,
    },
    relevantCanon: [],
    relevantDrafts: [],
    deprecatedItems: [],
    openQuestions: [],
    constraints: [
      config.writing.allowNewCanonWithoutConfirmation ? '' : '不得新增重大设定',
      config.writing.allowMajorPlotChangeWithoutConfirmation ? '' : '不得改变核心剧情方向',
    ].filter(Boolean),
  };

  if (extraContent) {
    contextPacket.relevantDrafts.push({
      source: 'input',
      content: extraContent,
    });
  }

  return { orchestrator, context: contextPacket };
}
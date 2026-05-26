/**
 * Tools - Agent 可用的工具定义
 * 
 * Tool Use 是 Agent 的核心能力:
 * - LLM 根据用户意图决定调用什么工具
 * - 系统执行工具并返回结果
 * - LLM 根据结果继续推理
 */

import { Orchestrator } from '@openwriter/core';
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
import type { WritingContextPacket, StyleProfile } from '@openwriter/core';

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  enum?: string[];
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  content: unknown;
}

// ==================== Tools 定义 ====================

/**
 * init 工具 - 初始化写作项目
 */
export const initTool: Tool = {
  name: 'init',
  description: '初始化一个新的写作项目。创建项目配置文件 openwriter.yaml，设置 canon 和 draft 目录。',
  parameters: {
    project_name: {
      type: 'string',
      description: '项目名称，例如 "我的科幻小说"',
      required: true,
    },
    genre: {
      type: 'string',
      description: '作品类型，例如 "科幻"、"奇幻"、"言情"',
      required: false,
    },
    language: {
      type: 'string',
      description: '写作语言，默认为 "zh-CN"',
      required: false,
      enum: ['zh-CN', 'en-US', 'ja-JP'],
    },
  },
  execute: async (args) => {
    const connector = new FileSystemConnector();
    const config = connector.initProject(args.project_name as string);
    return {
      message: `项目 "${config.project.name}" 已初始化`,
      configPath: 'openwriter.yaml',
      canonDirs: config.project.sourceOfTruth,
      draftDirs: config.project.draftDirs,
    };
  },
};

/**
 * write 工具 - 撰写内容
 */
export const writeTool: Tool = {
  name: 'write',
  description: '根据任务描述撰写新内容。可以是章节、场景、对话等。',
  parameters: {
    task: {
      type: 'string',
      description: '写作任务描述，例如 "写第一章开头，主角醒来发现自己在一个陌生的地方"',
      required: true,
    },
    context: {
      type: 'string',
      description: '额外上下文信息，例如已有角色、场景设定等',
      required: false,
    },
    model: {
      type: 'string',
      description: '使用的模型，可选 deepseek-chat 或 deepseek-reasoner',
      required: false,
    },
  },
  execute: async (args) => {
    // TODO: 实现写作逻辑
    return {
      content: '写作结果...',
      task: args.task,
    };
  },
};

/**
 * revise 工具 - 修订内容
 */
export const reviseTool: Tool = {
  name: 'revise',
  description: '修订、润色或改进已有内容。',
  parameters: {
    content: {
      type: 'string',
      description: '要修订的内容',
      required: true,
    },
    goal: {
      type: 'string',
      description: '修订目标，例如 "加强冲突感"、"简化语言"、"增加细节描写"',
      required: true,
    },
  },
  execute: async (args) => {
    return {
      revisedContent: '修订后的内容...',
      original: args.content,
      goal: args.goal,
    };
  },
};

/**
 * check 工具 - 检查连续性
 */
export const checkTool: Tool = {
  name: 'check',
  description: '检查内容的连续性和一致性。发现逻辑漏洞、设定冲突等问题。',
  parameters: {
    content: {
      type: 'string',
      description: '要检查的内容',
      required: true,
    },
    scope: {
      type: 'string',
      description: '检查范围: "full" 全项目检查, "chapter" 单章节检查',
      required: false,
      enum: ['full', 'chapter'],
    },
  },
  execute: async (args) => {
    return {
      issues: [],
      summary: '检查完成，发现问题数量: 0',
    };
  },
};

/**
 * brainstorm 工具 - 头脑风暴
 */
export const brainstormTool: Tool = {
  name: 'brainstorm',
  description: '头脑风暴，构思剧情、角色、设定、冲突等创意内容。',
  parameters: {
    topic: {
      type: 'string',
      description: '头脑风暴主题，例如 "如何让反派更有深度"、"主角的转折点"',
      required: true,
    },
    type: {
      type: 'string',
      description: '构思类型',
      required: false,
      enum: ['plot', 'character', 'setting', 'conflict', 'theme'],
    },
  },
  execute: async (args) => {
    return {
      ideas: ['想法1', '想法2', '想法3'],
      topic: args.topic,
    };
  },
};

/**
 * ls 工具 - 列出文件
 */
export const lsTool: Tool = {
  name: 'ls',
  description: '列出当前目录或指定目录的文件结构。',
  parameters: {
    path: {
      type: 'string',
      description: '要列出的目录路径，默认为当前目录',
      required: false,
    },
  },
  execute: async (args) => {
    // TODO: 实现文件列出逻辑
    return {
      files: ['canon/', 'draft/', 'openwriter.yaml'],
      path: args.path || '.',
    };
  },
};

/**
 * read 工具 - 读取文件
 */
export const readTool: Tool = {
  name: 'read',
  description: '读取指定文件的内容。',
  parameters: {
    path: {
      type: 'string',
      description: '文件路径',
      required: true,
    },
  },
  execute: async (args) => {
    // TODO: 实现文件读取逻辑
    return {
      content: '文件内容...',
      path: args.path,
    };
  },
};

/**
 * cd 工具 - 切换目录
 */
export const cdTool: Tool = {
  name: 'cd',
  description: '切换工作目录。',
  parameters: {
    path: {
      type: 'string',
      description: '目标目录路径',
      required: true,
    },
  },
  execute: async (args) => {
    return {
      currentDir: args.path,
      message: `已切换到 ${args.path}`,
    };
  },
};

/**
 * help 工具 - 显示帮助
 */
export const helpTool: Tool = {
  name: 'help',
  description: '显示使用帮助和可用工具列表。',
  parameters: {},
  execute: async () => {
    return {
      message: `
OpenWriter 使用指南

你可以用自然语言描述你的需求，我会理解你的意图并执行相应操作。

常见需求示例:
- "帮我写一个神秘老人出现的场景"
- "检查一下第一章有没有逻辑漏洞"
- "我想给反派角色设计一个更复杂的动机"
- "润色这段对话，让它更生动"

直接输入你想做的事情，我会帮你完成。
`,
      tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
    };
  },
};

// ==================== Tools 注册 ====================

export const TOOLS: Tool[] = [
  initTool,
  writeTool,
  reviseTool,
  checkTool,
  brainstormTool,
  lsTool,
  readTool,
  cdTool,
  helpTool,
];
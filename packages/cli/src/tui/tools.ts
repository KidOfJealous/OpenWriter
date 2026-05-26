/**
 * Tools - Agent 基础操作能力
 * 
 * Tools 是 Agent 的"手"，让 LLM 能操作真实世界。
 * 业务逻辑通过 Tool 组合 + LLM 推理实现，而不是单独的 Tool。
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'fs';
import { join, resolve, relative, dirname } from 'path';
import { execSync } from 'child_process';

// ==================== 上下文管理 ====================

export interface AgentContext {
  workDir: string;
}

let globalContext: AgentContext = { workDir: process.cwd() };

export function initContext(workDir: string): AgentContext {
  globalContext = { workDir };
  process.chdir(workDir);
  return globalContext;
}

export function getContext(): AgentContext {
  return globalContext;
}

export function setWorkDir(dir: string): void {
  globalContext.workDir = dir;
  process.chdir(dir);
}

// ==================== Tool 类型定义 ====================

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  execute: (args: Record<string, unknown>, context: AgentContext) => Promise<unknown>;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  content: unknown;
}

// ==================== 基础 Tools ====================

/**
 * read_file - 读取文件内容
 */
export const readFileTool: Tool = {
  name: 'read_file',
  description: '读取指定文件的内容。可以读取文本文件如 .md, .txt, .yaml, .json 等。',
  parameters: {
    path: {
      type: 'string',
      description: '文件路径，相对于工作目录',
      required: true,
    },
  },
  execute: async (args, context) => {
    const filePath = resolve(context.workDir, args.path as string);
    
    if (!existsSync(filePath)) {
      return { error: `文件不存在: ${args.path}` };
    }

    const content = readFileSync(filePath, 'utf-8');
    const stats = statSync(filePath);
    
    return {
      path: args.path,
      content,
      size: stats.size,
      lines: content.split('\n').length,
    };
  },
};

/**
 * write_file - 写入文件内容
 */
export const writeFileTool: Tool = {
  name: 'write_file',
  description: '写入内容到文件。如果文件不存在会创建，如果目录不存在会创建目录。',
  parameters: {
    path: {
      type: 'string',
      description: '文件路径，相对于工作目录',
      required: true,
    },
    content: {
      type: 'string',
      description: '要写入的文件内容',
      required: true,
    },
  },
  execute: async (args, context) => {
    const filePath = resolve(context.workDir, args.path as string);
    const dir = dirname(filePath);
    
    // 创建目录
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(filePath, args.content as string, 'utf-8');
    
    return {
      success: true,
      path: args.path,
      message: `已写入 ${args.path}`,
    };
  },
};

/**
 * ls - 列出目录内容
 */
export const lsTool: Tool = {
  name: 'ls',
  description: '列出目录中的文件和子目录。',
  parameters: {
    path: {
      type: 'string',
      description: '目录路径，默认为当前目录',
      required: false,
    },
  },
  execute: async (args, context) => {
    const targetPath = args.path 
      ? resolve(context.workDir, args.path as string)
      : context.workDir;
    
    if (!existsSync(targetPath)) {
      return { error: `目录不存在: ${targetPath}` };
    }

    const entries = readdirSync(targetPath, { withFileTypes: true });
    const items = entries.map(e => ({
      name: e.name,
      type: e.isDirectory() ? 'directory' : 'file',
    }));

    return {
      path: relative(context.workDir, targetPath) || '.',
      items,
    };
  },
};

/**
 * grep - 搜索文件内容
 */
export const grepTool: Tool = {
  name: 'grep',
  description: '在文件中搜索匹配正则表达式的内容。返回匹配的行和文件路径。',
  parameters: {
    pattern: {
      type: 'string',
      description: '正则表达式模式',
      required: true,
    },
    path: {
      type: 'string',
      description: '搜索路径，可以是文件或目录',
      required: false,
    },
  },
  execute: async (args, context) => {
    const pattern = new RegExp(args.pattern as string, 'g');
    const searchPath = args.path 
      ? resolve(context.workDir, args.path as string)
      : context.workDir;

    const results: Array<{ file: string; line: number; content: string }> = [];

    const searchFile = (filePath: string) => {
      if (!existsSync(filePath)) return;
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        if (pattern.test(line)) {
          results.push({
            file: relative(context.workDir, filePath),
            line: i + 1,
            content: line.trim(),
          });
        }
        pattern.lastIndex = 0; // 重置正则
      });
    };

    const searchDir = (dirPath: string) => {
      if (!existsSync(dirPath)) return;
      const entries = readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          searchDir(fullPath);
        } else if (entry.isFile() && !entry.name.startsWith('.')) {
          searchFile(fullPath);
        }
      }
    };

    if (existsSync(searchPath)) {
      const stats = statSync(searchPath);
      if (stats.isDirectory()) {
        searchDir(searchPath);
      } else {
        searchFile(searchPath);
      }
    }

    return {
      pattern: args.pattern,
      matches: results,
      count: results.length,
    };
  },
};

/**
 * execute - 执行 shell 命令
 */
export const executeTool: Tool = {
  name: 'execute',
  description: '执行 shell 命令。用于运行测试、构建、git 操作等。',
  parameters: {
    command: {
      type: 'string',
      description: '要执行的命令',
      required: true,
    },
  },
  execute: async (args, context) => {
    try {
      const output = execSync(args.command as string, {
        cwd: context.workDir,
        encoding: 'utf-8',
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      
      return {
        success: true,
        output,
        command: args.command,
      };
    } catch (err) {
      const error = err as { stdout?: string; stderr?: string; message?: string };
      return {
        success: false,
        error: error.stderr || error.message,
        stdout: error.stdout,
        command: args.command,
      };
    }
  },
};

/**
 * glob - 按模式查找文件
 */
export const globTool: Tool = {
  name: 'glob',
  description: '按通配符模式查找文件。例如 "*.md" 查找所有 markdown 文件。',
  parameters: {
    pattern: {
      type: 'string',
      description: '通配符模式，如 "*.md", "draft/**\/*.md"',
      required: true,
    },
    path: {
      type: 'string',
      description: '搜索起始目录',
      required: false,
    },
  },
  execute: async (args, context) => {
    const basePath = args.path 
      ? resolve(context.workDir, args.path as string)
      : context.workDir;
    
    const pattern = args.pattern as string;
    const files: string[] = [];

    const matchPattern = (fileName: string) => {
      // 简单通配符匹配
      const regex = new RegExp(
        pattern
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^\\/]*')
          .replace(/\./g, '\\.')
      );
      return regex.test(fileName);
    };

    const walk = (dir: string) => {
      if (!existsSync(dir)) return;
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relPath = relative(context.workDir, fullPath);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (matchPattern(relPath) || matchPattern(entry.name)) {
          files.push(relPath);
        }
      }
    };

    walk(basePath);

    return {
      pattern,
      files,
      count: files.length,
    };
  },
};

/**
 * cd - 切换工作目录
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
  execute: async (args, context) => {
    const targetPath = resolve(context.workDir, args.path as string);
    
    if (!existsSync(targetPath)) {
      return { error: `目录不存在: ${args.path}` };
    }

    setWorkDir(targetPath);
    
    return {
      success: true,
      workDir: targetPath,
    };
  },
};

/**
 * pwd - 显示当前目录
 */
export const pwdTool: Tool = {
  name: 'pwd',
  description: '显示当前工作目录。',
  parameters: {},
  execute: async (_, context) => {
    return {
      workDir: context.workDir,
    };
  },
};

/**
 * create_directory - 创建目录
 */
export const createDirectoryTool: Tool = {
  name: 'create_directory',
  description: '创建新目录。如果父目录不存在会一并创建。',
  parameters: {
    path: {
      type: 'string',
      description: '要创建的目录路径',
      required: true,
    },
  },
  execute: async (args, context) => {
    const dirPath = resolve(context.workDir, args.path as string);
    
    if (existsSync(dirPath)) {
      return { message: `目录已存在: ${args.path}` };
    }

    mkdirSync(dirPath, { recursive: true });
    
    return {
      success: true,
      path: args.path,
      message: `已创建目录: ${args.path}`,
    };
  },
};

/**
 * edit_file - 编辑文件（替换内容）
 */
export const editFileTool: Tool = {
  name: 'edit_file',
  description: '编辑文件，替换指定内容。用于修改现有文件。',
  parameters: {
    path: {
      type: 'string',
      description: '文件路径',
      required: true,
    },
    old_text: {
      type: 'string',
      description: '要替换的原始文本',
      required: true,
    },
    new_text: {
      type: 'string',
      description: '替换后的新文本',
      required: true,
    },
  },
  execute: async (args, context) => {
    const filePath = resolve(context.workDir, args.path as string);
    
    if (!existsSync(filePath)) {
      return { error: `文件不存在: ${args.path}` };
    }

    const content = readFileSync(filePath, 'utf-8');
    const oldText = args.old_text as string;
    const newText = args.new_text as string;

    if (!content.includes(oldText)) {
      return { error: `未找到要替换的内容` };
    }

    const newContent = content.replace(oldText, newText);
    writeFileSync(filePath, newContent, 'utf-8');

    return {
      success: true,
      path: args.path,
      message: `已编辑 ${args.path}`,
    };
  },
};

// ==================== Tools 注册 ====================

export const TOOLS: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  lsTool,
  grepTool,
  globTool,
  executeTool,
  cdTool,
  pwdTool,
  createDirectoryTool,
];
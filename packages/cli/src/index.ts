#!/usr/bin/env node
import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { App } from './tui/App.js';

const program = new Command();
program
  .name('wa')
  .description('OpenWriter Writing Agent CLI - AI 辅助小说写作框架')
  .version('0.1.0')
  .option('--no-tui', '使用传统命令行模式而非 TUI')
  .option('--tui', '使用 TUI 交互模式（默认）');

// Default action: launch TUI
program.action((opts) => {
  if (opts.noTui) {
    console.log('请使用具体命令，如: wa write, wa check, wa revise 等');
    console.log('运行 wa --help 查看所有命令');
    return;
  }
  
  // Launch TUI
  render(React.createElement(App));
});

// wa init
program
  .command('init')
  .description('初始化写作项目')
  .argument('[name]', '项目名称')
  .action((name?: string) => {
    import('./tui/executor.js').then(({ executeCommand }) => {
      executeCommand('init', name || '').then(result => {
        console.log(result.output);
      });
    });
  });

// wa write
program
  .command('write')
  .description('撰写章节或内容')
  .option('--task <task>', '写作任务描述')
  .option('--file <file>', '目标文件路径')
  .option('--model <model>', 'LLM 模型')
  .action(async (opts: { task?: string; file?: string; model?: string }) => {
    const { executeCommand } = await import('./tui/executor.js');
    const result = await executeCommand('write', opts.task || '', undefined, { model: opts.model });
    console.log(result.output);
    if (opts.file) {
      const { FileSystemConnector } = await import('@openwriter/connectors');
      const connector = new FileSystemConnector();
      connector.writeContent(opts.file, result.output);
      console.log(`\n已保存到: ${opts.file}`);
    }
  });

// wa check
program
  .command('check')
  .description('检查连续性与一致性')
  .option('--file <file>', '要检查的文件')
  .option('--model <model>', 'LLM 模型')
  .action(async (opts: { file?: string; model?: string }) => {
    const { executeCommand } = await import('./tui/executor.js');
    const result = await executeCommand('check', opts.file || '', undefined, { model: opts.model });
    console.log(result.output);
  });

// wa revise
program
  .command('revise')
  .description('修订或润色文本')
  .option('--file <file>', '要修订的文件')
  .option('--goal <goal>', '修订目标')
  .option('--model <model>', 'LLM 模型')
  .action(async (opts: { file?: string; goal?: string; model?: string }) => {
    const { executeCommand } = await import('./tui/executor.js');
    let input = opts.goal || '';
    if (opts.file) {
      const { readFileSync, existsSync } = await import('fs');
      const { resolve } = await import('path');
      const filePath = resolve(process.cwd(), opts.file);
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8');
        input = `${opts.goal || '润色文本'}\n文件内容:\n${content}`;
      }
    }
    const result = await executeCommand('revise', input, undefined, { model: opts.model });
    console.log(result.output);
  });

// wa brainstorm
program
  .command('brainstorm')
  .description('头脑风暴剧情或设定')
  .option('--task <task>', '头脑风暴主题')
  .option('--model <model>', 'LLM 模型')
  .action(async (opts: { task?: string; model?: string }) => {
    const { executeCommand } = await import('./tui/executor.js');
    const result = await executeCommand('brainstorm', opts.task || '', undefined, { model: opts.model });
    console.log(result.output);
  });

// wa plan
program
  .command('plan')
  .description('规划章节结构')
  .option('--task <task>', '规划任务')
  .option('--model <model>', 'LLM 模型')
  .action(async (opts: { task?: string; model?: string }) => {
    const { executeCommand } = await import('./tui/executor.js');
    const result = await executeCommand('plan', opts.task || '', undefined, { model: opts.model });
    console.log(result.output);
  });

// wa style
program
  .command('style')
  .description('检查文风与语言')
  .option('--file <file>', '要检查的文件')
  .option('--model <model>', 'LLM 模型')
  .action(async (opts: { file?: string; model?: string }) => {
    const { executeCommand } = await import('./tui/executor.js');
    let input = '';
    if (opts.file) {
      const { readFileSync, existsSync } = await import('fs');
      const { resolve } = await import('path');
      const filePath = resolve(process.cwd(), opts.file);
      if (existsSync(filePath)) {
        input = readFileSync(filePath, 'utf-8');
      }
    }
    const result = await executeCommand('style', input, undefined, { model: opts.model });
    console.log(result.output);
  });

// wa tui - explicit TUI command
program
  .command('tui')
  .description('启动 TUI 交互模式')
  .action(() => {
    render(React.createElement(App));
  });

program.parse();
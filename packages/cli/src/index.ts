#!/usr/bin/env node
import { Command } from 'commander';
import { Orchestrator, createProvider } from '@openwriter/core';
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
import type { WritingContextPacket, ProjectConfig, StyleProfile } from '@openwriter/core';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'yaml';

const program = new Command();
program.name('wa').description('OpenWriter Writing Agent CLI').version('0.1.0');

// wa init
program
  .command('init')
  .description('Initialize a writing project')
  .argument('[name]', 'Project name')
  .action((name?: string) => {
    const connector = new FileSystemConnector();
    const config = connector.initProject(name);
    console.log(`Initialized writing project: ${config.project.name}`);
    console.log(`Config: openwriter.yaml`);
    console.log(`Canon dirs: ${config.project.sourceOfTruth.join(', ')}`);
    console.log(`Draft dirs: ${config.project.draftDirs.join(', ')}`);
  });

// wa write
program
  .command('write')
  .description('Write a chapter or section')
  .option('--task <task>', 'Writing task description')
  .option('--file <file>', 'Target file path')
  .option('--model <model>', 'LLM model to use')
  .action(async (opts: { task?: string; file?: string; model?: string }) => {
    const { orchestrator, context } = await buildContext(opts.task);
    if (!context) return;

    const results = await orchestrator.executeWorkflow('chapterWriting', context, {
      model: opts.model,
    });

    const writerResult = results['prose-writer'];
    if (writerResult && writerResult.type === 'text') {
      console.log('\n=== Generated Content ===\n');
      console.log(writerResult.content);

      if (opts.file) {
        const connector = new FileSystemConnector();
        connector.writeContent(opts.file, writerResult.content as string);
        console.log(`\nSaved to: ${opts.file}`);
      }
    }

    // Show continuity check results
    const checkResult = results['continuity-checker'];
    if (checkResult?.metadata) {
      const m = checkResult.metadata as Record<string, number>;
      if ((m.hardConflicts ?? 0) > 0) {
        console.log(`\n⚠ Found ${m.hardConflicts} hard conflict(s)`);
      }
    }

    // Show critic results
    const criticResult = results['critic'];
    if (criticResult?.metadata) {
      const m = criticResult.metadata as Record<string, number>;
      if ((m.p0Count ?? 0) > 0) {
        console.log(`\n⚠ Found ${m.p0Count} P0 issue(s)`);
      }
    }
  });

// wa check
program
  .command('check')
  .description('Check continuity and consistency')
  .option('--file <file>', 'File to check')
  .option('--model <model>', 'LLM model to use')
  .action(async (opts: { file?: string; model?: string }) => {
    const task = opts.file ? `检查 ${opts.file} 的连续性` : '检查项目连续性';
    const { orchestrator, context } = await buildContext(task);
    if (!context) return;

    const results = await orchestrator.executeWorkflow('continuityCheck', context, {
      model: opts.model,
    });

    const checkResult = results['continuity-checker'];
    if (checkResult?.content) {
      console.log('\n=== Continuity Check ===\n');
      const issues = checkResult.content as Array<{ severity: string; description: string }>;
      if (issues.length === 0) {
        console.log('No issues found.');
      } else {
        for (const issue of issues) {
          const tag = issue.severity === 'hard' ? 'HARD' : issue.severity === 'soft' ? 'SOFT' : 'UNCERTAIN';
          console.log(`[${tag}] ${issue.description}`);
        }
      }
    }

    const criticResult = results['critic'];
    if (criticResult?.content) {
      console.log('\n=== Critique ===\n');
      const items = criticResult.content as Array<{ priority: string; dimension: string; description: string }>;
      if (items.length === 0) {
        console.log('No critique issues found.');
      } else {
        for (const item of items) {
          console.log(`[${item.priority}] (${item.dimension}) ${item.description}`);
        }
      }
    }
  });

// wa revise
program
  .command('revise')
  .description('Revise/polish a file')
  .option('--file <file>', 'File to revise')
  .option('--goal <goal>', 'Revision goal (e.g., "加强冲突")')
  .option('--model <model>', 'LLM model to use')
  .action(async (opts: { file?: string; goal?: string; model?: string }) => {
    const fileContent = opts.file && existsSync(resolve(process.cwd(), opts.file))
      ? readFileSync(resolve(process.cwd(), opts.file), 'utf-8')
      : '';

    const task = opts.goal ?? '润色文本';
    const { orchestrator, context } = await buildContext(task, fileContent);
    if (!context) return;

    const results = await orchestrator.executeWorkflow('polish', context, {
      model: opts.model,
    });

    const writerResult = results['prose-writer'];
    if (writerResult?.type === 'text') {
      console.log('\n=== Revised Content ===\n');
      console.log(writerResult.content);
    }
  });

// wa brainstorm
program
  .command('brainstorm')
  .description('Brainstorm plot ideas, settings, or character arcs')
  .option('--task <task>', 'Brainstorm topic')
  .option('--model <model>', 'LLM model to use')
  .action(async (opts: { task?: string; model?: string }) => {
    const { orchestrator, context } = await buildContext(opts.task ?? '头脑暴剧情或设定');
    if (!context) return;

    const results = await orchestrator.executeWorkflow('brainstorm', context, {
      model: opts.model,
    });

    // Show results from all agents
    for (const [agentName, result] of Object.entries(results)) {
      if (result?.content) {
        console.log(`\n=== ${agentName} ===\n`);
        if (typeof result.content === 'string') {
          console.log(result.content);
        } else {
          console.log(JSON.stringify(result.content, null, 2));
        }
      }
    }
  });

// wa plan
program
  .command('plan')
  .description('Plan chapter structure')
  .option('--task <task>', 'Planning task')
  .option('--model <model>', 'LLM model to use')
  .action(async (opts: { task?: string; model?: string }) => {
    const { orchestrator, context } = await buildContext(opts.task ?? '规划章节结构');
    if (!context) return;

    const results = await orchestrator.executeWorkflow('chapterWriting', context, {
      model: opts.model,
    });

    // Show plot analysis
    const plotResult = results['plot-architect'];
    if (plotResult?.content) {
      console.log('\n=== Plot Analysis ===\n');
      const items = plotResult.content as Array<{ issue: string; severity: string; suggestion: string }>;
      for (const item of items) {
        console.log(`[${item.severity}] ${item.issue}`);
        if (item.suggestion) console.log(`  → ${item.suggestion}`);
        console.log();
      }
    }

    // Show character analysis
    const charResult = results['character-agent'];
    if (charResult?.content) {
      console.log('\n=== Character Analysis ===\n');
      const chars = charResult.content as Array<{ name: string; wants: string; fears: string; arcChange: string }>;
      for (const c of chars) {
        console.log(`${c.name}: 想要${c.wants} / 害怕${c.fears} / 弧线变化: ${c.arcChange}`);
      }
    }
  });

// wa style
program
  .command('style')
  .description('Check prose style and language')
  .option('--file <file>', 'File to check')
  .option('--model <model>', 'LLM model to use')
  .action(async (opts: { file?: string; model?: string }) => {
    const fileContent = opts.file && existsSync(resolve(process.cwd(), opts.file))
      ? readFileSync(resolve(process.cwd(), opts.file), 'utf-8')
      : '';

    const { orchestrator, context } = await buildContext('检查文风', fileContent);
    if (!context) return;

    const results = await orchestrator.executeWorkflow('polish', context, {
      model: opts.model,
    });

    const styleResult = results['style-editor'];
    if (styleResult?.content) {
      console.log('\n=== Style Check ===\n');
      const items = styleResult.content as Array<{ type: string; line: string; issue: string; suggestion: string }>;
      if (items.length === 0) {
        console.log('No style issues found.');
      } else {
        for (const item of items) {
          console.log(`[${item.type}] "${item.line}"`);
          console.log(`  → ${item.suggestion}`);
          console.log();
        }
      }
    }
  });

async function buildContext(task?: string, extraContent?: string) {
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
    console.error('No openwriter.yaml found. Run `wa init` first.');
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

  // If extra content provided, add it as a draft
  if (extraContent) {
    contextPacket.relevantDrafts.push({
      source: 'input',
      content: extraContent,
    });
  }

  return { orchestrator, context: contextPacket };
}

program.parse();

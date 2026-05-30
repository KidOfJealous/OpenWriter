import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse, stringify } from 'yaml';
import type { ProjectConfig } from '@openwriter/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class FileSystemConnector {
  private projectDir: string;

  constructor(projectDir: string = process.cwd()) {
    this.projectDir = projectDir;
  }

  readConfig(): ProjectConfig | null {
    const configPath = join(this.projectDir, 'openwriter.yaml');
    if (!existsSync(configPath)) return null;
    const raw = readFileSync(configPath, 'utf-8');
    return parse(raw) as ProjectConfig;
  }

  initProject(name?: string): ProjectConfig {
    const templatePath = this.findProjectTemplatePath();
    let template: ProjectConfig;

    if (existsSync(templatePath)) {
      const raw = readFileSync(templatePath, 'utf-8');
      template = parse(raw) as ProjectConfig;
    } else {
      template = this.getDefaultTemplate();
    }

    if (name) template.project.name = name;

    const configPath = join(this.projectDir, 'openwriter.yaml');
    writeFileSync(configPath, stringify(template), 'utf-8');

    return template;
  }

  readContent(filePath: string): string {
    const fullPath = resolve(this.projectDir, filePath);
    return readFileSync(fullPath, 'utf-8');
  }

  writeContent(filePath: string, content: string): void {
    const fullPath = resolve(this.projectDir, filePath);
    const dir = resolve(fullPath, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
  }

  private findProjectTemplatePath(): string {
    const candidates = [
      resolve(__dirname, '../../../configs/project-template.yaml'),
      resolve(__dirname, '../../../../configs/project-template.yaml'),
    ];

    return candidates.find(path => existsSync(path)) ?? candidates[0];
  }

  private getDefaultTemplate(): ProjectConfig {
    return {
      project: {
        name: 'My Writing Project',
        language: 'zh-CN',
        genre: 'fantasy',
      },
      writing: {
        defaultMode: 'plan_then_write',
        allowNewCanonWithoutConfirmation: false,
        allowMajorPlotChangeWithoutConfirmation: false,
      },
      style: {
        proseProfile: 'custom',
        descriptionDensity: 'medium',
        dialogueStyle: 'restrained',
        pov: 'third_limited',
        taboo: ['不要口号化', '不要替角色总结情绪'],
      },
      memory: {
        canonStates: ['idea', 'candidate', 'canon', 'deprecated'],
        requireConfirmationForCanon: true,
      },
      retrieval: {
        exactMatchWeight: 0.5,
        vectorWeight: 0.3,
        recencyWeight: 0.2,
        deprecatedPenalty: 0.8,
      },
      cache: {
        enabled: true,
        strategy: 'aggressive',
        stablePrefix: true,
        appendOnlyWorkflowLog: true,
        maxCanonEntries: 32,
        maxDraftEntries: 8,
        maxCanonEntryChars: 4000,
        maxDraftEntryChars: 12000,
        maxWorkflowLogEntries: 12,
        maxResultChars: 1800,
        maxTotalContextChars: 120000,
      },
      models: {},
    };
  }
}

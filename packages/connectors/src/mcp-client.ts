import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export class McpClient {
  private configPath: string;

  constructor(configPath: string = resolve(process.cwd(), 'mcp-servers.json')) {
    this.configPath = configPath;
  }

  getServerConfig(name: string): McpServerConfig | null {
    if (!existsSync(this.configPath)) return null;
    const raw = readFileSync(this.configPath, 'utf-8');
    const config = JSON.parse(raw) as McpConfig;
    return config.mcpServers?.[name] ?? null;
  }

  listServers(): string[] {
    if (!existsSync(this.configPath)) return [];
    const raw = readFileSync(this.configPath, 'utf-8');
    const config = JSON.parse(raw) as McpConfig;
    return Object.keys(config.mcpServers ?? {});
  }
}

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export function generateMcpConfig(projectDir: string): McpConfig {
  return {
    mcpServers: {
      filesystem: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', projectDir],
        env: {},
      },
      git: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-git'],
        env: {},
      },
    },
  };
}

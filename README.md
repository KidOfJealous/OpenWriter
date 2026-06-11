<p align="center">
  <img src="docs/logo.svg" alt="OpenWriter" width="640"/>
</p>

<p align="center">
  <strong>English</strong>
  ·
  <a href="docs/README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/KidOfJealous/OpenWriter/releases"><img src="https://img.shields.io/github/v/release/KidOfJealous/OpenWriter?style=flat-square&color=cb3837&labelColor=161b22&logo=github&logoColor=white" alt="release"/></a>
  <a href="https://github.com/KidOfJealous/OpenWriter/actions"><img src="https://img.shields.io/github/actions/workflow/status/KidOfJealous/OpenWriter/ci.yml?style=flat-square&label=ci&labelColor=161b22&logo=githubactions&logoColor=white" alt="CI"/></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/KidOfJealous/OpenWriter?style=flat-square&color=8b949e&labelColor=161b22" alt="license"/></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D22.0.0-339933?style=flat-square&labelColor=161b22&logo=node.js&logoColor=white" alt="node"/></a>
  <a href="https://github.com/KidOfJealous/OpenWriter/stargazers"><img src="https://img.shields.io/github/stars/KidOfJealous/OpenWriter?style=flat-square&color=dbab09&labelColor=161b22&logo=github&logoColor=white" alt="stars"/></a>
  <a href="https://github.com/KidOfJealous/OpenWriter/graphs/contributors"><img src="https://img.shields.io/github/contributors/KidOfJealous/OpenWriter?style=flat-square&color=bc8cff&labelColor=161b22&logo=github&logoColor=white" alt="contributors"/></a>
  <a href="https://discord.gg/openwriter"><img src="https://img.shields.io/badge/discord-join-5865F2?style=flat-square&labelColor=161b22&logo=discord&logoColor=white" alt="discord"/></a>
</p>

<br/>

<h3 align="center">A multi-agent writing framework for long-form fiction.</h3>
<p align="center">A terminal-native AI writing assistant with specialist agents for plot, character, style, and continuity — tuned for Chinese-language fiction.</p>

<br/>

## Features

- **Multi-agent architecture.** Specialist agents for plot structure, character consistency, style editing, worldbuilding, and continuity checking — orchestrated by a lead agent.
- **Persistent memory system.** Canon entries (characters, settings, timeline) persist in `canon/` directory across sessions. `curate_memory` extracts changes, `save_canon` writes them to disk.
- **Smart context retrieval.** TF-IDF-like scoring (exact match + cosine similarity + recency) finds relevant drafts and canon for each task.
- **Aggressive prompt caching.** Stable prefix ordering and context trimming maximize LLM prefix cache hits, reducing token costs.
- **Terminal-native TUI.** Built with React/Ink for a rich interactive experience: live streaming, tool execution progress, session usage tracking.
- **Loop guard.** Detects repeated tool failures and nudges the agent to change approach instead of looping.
- **Read-only parallel execution.** Multiple read-only tools run in parallel for faster analysis.
- **Config-driven.** Project settings in `openwriter.yaml` — style, memory policy, retrieval weights, cache policy.

## Architecture

```
┌─────────────────────────────────────────────┐
│                   CLI (TUI)                  │
│              ChatInterface.tsx               │
└─────────────┬───────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│              Writing Agent Loop              │
│         (tool-calling ReAct loop)            │
├─────────────────────────────────────────────┤
│ File Tools    │ Specialist Tools │ Memory    │
│ list_dir      │ analyze_plot     │ save_canon│
│ glob          │ analyze_chars    │ gather_ctx│
│ grep          │ check_continuity │           │
│ read_file     │ review_style     │           │
│ write_file    │ check_world      │           │
│ edit_file     │ critique         │           │
│               │ curate_memory    │           │
│               │ write_prose      │           │
└───────────────┴──────────────────┴───────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│              @openwriter/core                │
│  Types · Cache Manager · LLM Providers     │
│  (DeepSeek · OpenAI-compatible · Ollama)    │
└─────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js >= 22.0.0
- A DeepSeek API key (or any OpenAI-compatible endpoint)

### Installation

```sh
# Clone the repository
git clone https://github.com/KidOfJealous/OpenWriter.git
cd OpenWriter

# Install dependencies
npm install

# Build
npm run build

# Initialize a writing project
mkdir my-novel && cd my-novel
npm run wa -- /init my-novel
```

### Usage

```sh
# Start the TUI
npm run wa

# Inside the TUI:
# /write <task>       — Enable file editing and write to files
# /init <name>        — Initialize a new writing project
# /config             — Configure LLM provider and model
# /provider <id>      — Switch provider (deepseek / custom)
# /model <id>         — Switch model within current provider
# /cd <path>          — Change workspace directory
# /save <path>        — Save latest output to a file
# /clear              — Clear session
# /quit               — Exit

# Or just type naturally:
> 帮我检查第三章的情节逻辑
> 写一段林上和陈默在雨夜重逢的场景
> 分析一下主角的性格弧光
```

### Configuration

Set your API key via environment variable:

```sh
export DEEPSEEK_API_KEY=sk-xxx
# or for OpenAI-compatible providers
export OPENAI_API_KEY=sk-xxx
```

Or use the `/config` command inside the TUI to configure interactively.

Project settings are stored in `openwriter.yaml` in your workspace:

```yaml
project:
  name: "My Novel"
  language: "zh-CN"
  genre: "fantasy"

style:
  proseProfile: "custom"
  descriptionDensity: "medium"
  dialogueStyle: "restrained"
  pov: "third_limited"
  taboo:
    - "不要口号化"
    - "不要替角色总结情绪"

memory:
  canonStates: [idea, candidate, canon, deprecated]
  requireConfirmationForCanon: true
```

## Project Structure

```
OpenWriter/
├── packages/
│   ├── core/          # Types, cache manager, LLM providers, cost tracking
│   ├── agents/        # Specialist agents (plot, character, style, etc.)
│   ├── connectors/    # File system I/O, MCP integration
│   └── cli/           # Terminal UI (React/Ink) and agent loop
├── configs/
│   └── project-template.yaml
├── scripts/
│   └── package.mjs    # Build & package for distribution
└── docs/
```

## Packages

| Package | Description |
|---------|-------------|
| `@openwriter/core` | Core types, `AggressiveCacheManager`, LLM providers (DeepSeek, OpenAI, Ollama), cost estimation |
| `@openwriter/agents` | 9 specialist agents: ContextRetriever, ProseWriter, PlotArchitect, CharacterAgent, WorldbuildingAgent, StyleEditor, ContinuityChecker, Critic, MemoryCurator |
| `@openwriter/connectors` | File system connector, MCP client (stub) |
| `@openwriter/cli` | Terminal UI with React/Ink, writing agent loop, model configuration |

## Development

```sh
# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test

# Run in dev mode
npm run wa
```

## Packaging

Build standalone distributable packages:

```sh
npm run package        # All platforms (win32, linux, darwin)
npm run package:mac    # macOS only
npm run package:linux  # Linux only
npm run package:win    # Windows only
```

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE) — Free for personal and commercial use.

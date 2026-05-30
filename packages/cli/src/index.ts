#!/usr/bin/env node
import { render } from 'ink';
import React from 'react';
import { ChatInterface } from './tui/ChatInterface.js';

const VERSION = '0.1.0';
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h') || args[0] === 'help') {
  printHelp();
  process.exit(0);
}

if (args.includes('--version') || args.includes('-V')) {
  console.log(VERSION);
  process.exit(0);
}

if (!process.stdin.isTTY) {
  console.error('OpenWriter Agent TUI needs an interactive terminal. Run `wa --help` for usage.');
  process.exit(1);
}

render(React.createElement(ChatInterface));

function printHelp() {
  console.log(`OpenWriter ${VERSION}

Usage:
  wa                 Launch the Agent TUI
  wa --help          Show this help
  wa --version       Show version

Inside the TUI:
  /init <name>       Initialize a writing project
  /write <task>      Allow explicit file edits through tools
  /check <task>      Read-only continuity or structure check
  /brainstorm <task> Brainstorm naturally; save only when asked
  /style <file>      Review style by default
  /setting <task>    Expand setting/worldbuilding
  /config            Configure providers
  /provider <id>     Switch provider preset
  /model <id>        Switch model
  /cd <path>         Change workspace
  /clear             Clear the session view
  /quit              Exit
`);
}

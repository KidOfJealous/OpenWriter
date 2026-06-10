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
  Type naturally     The agent decides which tools and specialists to use
  /write <task>      Enable file edits for this turn
  /init <name>       Initialize a writing project
  /save <path>       Save the latest output to a file
  /config            Configure providers and models
  /provider <id>     Switch provider preset
  /model <id>        Switch model
  /cd <path>         Change workspace
  /clear             Clear the session view
  /quit              Exit
`);
}

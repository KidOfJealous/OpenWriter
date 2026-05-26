#!/usr/bin/env node
import { render } from 'ink';
import React from 'react';
import { ChatInterface } from './tui/ChatInterface.js';

// Default: launch chat TUI
render(React.createElement(ChatInterface));
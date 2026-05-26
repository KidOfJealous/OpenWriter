import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useApp, useInput, Newline } from 'ink';
import Spinner from 'ink-spinner';
import { CommandMenu } from './CommandMenu.js';
import { StatusBar } from './StatusBar.js';
import { OutputDisplay } from './OutputDisplay.js';
import { InputPrompt } from './InputPrompt.js';
import { executeCommand, type CommandResult } from './executor.js';
import { type AgentStatus } from './StatusBar.js';

export type AppMode = 'menu' | 'input' | 'executing' | 'result';

export interface AppState {
  mode: AppMode;
  selectedCommand: string | null;
  inputValue: string;
  output: string;
  agentStatuses: AgentStatus[];
  result: CommandResult | null;
  error: string | null;
}

export function App() {
  const { exit } = useApp();
  const [state, setState] = useState<AppState>({
    mode: 'menu',
    selectedCommand: null,
    inputValue: '',
    output: '',
    agentStatuses: [],
    result: null,
    error: null,
  });

  // Handle global keyboard input
  useInput((input, key) => {
    if (key.escape) {
      if (state.mode === 'menu') {
        exit();
      } else if (state.mode === 'input' || state.mode === 'result') {
        setState(prev => ({ ...prev, mode: 'menu', inputValue: '', output: '', result: null, error: null }));
      }
    }
    if (key.ctrl && input === 'c') {
      exit();
    }
  });

  const handleCommandSelect = useCallback((command: string) => {
    // Commands that need input
    const needsInput = ['write', 'revise', 'check', 'style', 'brainstorm', 'plan'];
    if (needsInput.includes(command)) {
      setState(prev => ({ ...prev, mode: 'input', selectedCommand: command, inputValue: '' }));
    } else if (command === 'exit') {
      exit();
    } else {
      // Execute immediately (like init)
      setState(prev => ({ ...prev, mode: 'executing', selectedCommand: command }));
      executeCommand(command, '')
        .then(result => {
          setState(prev => ({ ...prev, mode: 'result', result, output: result.output }));
        })
        .catch(err => {
          setState(prev => ({ ...prev, mode: 'result', error: err.message }));
        });
    }
  }, [exit]);

  const handleInputSubmit = useCallback((value: string) => {
    setState(prev => ({ ...prev, mode: 'executing', inputValue: value }));
    
    executeCommand(state.selectedCommand!, value, (statuses) => {
      setState(prev => ({ ...prev, agentStatuses: statuses }));
    })
      .then(result => {
        setState(prev => ({ ...prev, mode: 'result', result, output: result.output }));
      })
      .catch(err => {
        setState(prev => ({ ...prev, mode: 'result', error: err.message }));
      });
  }, [state.selectedCommand]);

  const handleInputChange = useCallback((value: string) => {
    setState(prev => ({ ...prev, inputValue: value }));
  }, []);

  // Render header
  const Header = () => (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
      <Text bold color="cyan">OpenWriter</Text>
      <Text color="gray"> - AI 辅助小说写作框架</Text>
    </Box>
  );

  // Render based on mode
  return (
    <Box flexDirection="column" height="100%">
      <Header />
      
      {state.mode === 'menu' && (
        <CommandMenu onSelect={handleCommandSelect} />
      )}
      
      {state.mode === 'input' && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color="yellow">命令: </Text>
            <Text bold>{state.selectedCommand}</Text>
          </Box>
          <InputPrompt
            prompt={getPromptForCommand(state.selectedCommand!)}
            value={state.inputValue}
            onChange={handleInputChange}
            onSubmit={handleInputSubmit}
          />
          <Box marginTop={1}>
            <Text dimColor>按 ESC 返回菜单</Text>
          </Box>
        </Box>
      )}
      
      {state.mode === 'executing' && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color="yellow">执行: </Text>
            <Text bold>{state.selectedCommand}</Text>
            <Box marginLeft={2}>
              <Spinner type="dots" />
            </Box>
          </Box>
          <StatusBar statuses={state.agentStatuses} />
          {state.output && (
            <Box marginTop={1} flexDirection="column">
              <Text dimColor>输出预览:</Text>
              <OutputDisplay content={state.output} maxHeight={10} />
            </Box>
          )}
        </Box>
      )}
      
      {state.mode === 'result' && (
        <Box flexDirection="column">
          {state.error ? (
            <Box borderStyle="round" borderColor="red" padding={1}>
              <Text color="red">错误: {state.error}</Text>
            </Box>
          ) : (
            <>
              {state.result && (
                <Box marginBottom={1}>
                  <Text color="green">✓ 完成</Text>
                  <Text dimColor> (耗时: {state.result.duration}ms)</Text>
                </Box>
              )}
              <OutputDisplay content={state.output} maxHeight={20} />
              {state.result?.usage && (
                <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
                  <Text dimColor>
                    Token: {state.result.usage.promptTokens} + {state.result.usage.completionTokens} | 
                    成本: ${state.result.usage.cost?.toFixed(4) ?? 'N/A'}
                  </Text>
                </Box>
              )}
            </>
          )}
          <Box marginTop={1}>
            <Text dimColor>按 ESC 返回菜单</Text>
          </Box>
        </Box>
      )}
      
      <Box marginTop={1}>
        <Text dimColor>Ctrl+C 退出</Text>
      </Box>
    </Box>
  );
}

function getPromptForCommand(command: string): string {
  const prompts: Record<string, string> = {
    write: '输入写作任务描述...',
    revise: '输入修订目标或文件路径...',
    check: '输入要检查的文件路径...',
    style: '输入要检查风格的文件路径...',
    brainstorm: '输入头脑风暴主题...',
    plan: '输入章节规划任务...',
  };
  return prompts[command] ?? '输入参数...';
}
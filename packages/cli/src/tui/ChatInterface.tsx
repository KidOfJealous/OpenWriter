import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { ModelConfig } from './ModelConfig.js';
import { DirectorySelector } from './DirectorySelector.js';
import { MessageList } from './MessageList.js';
import { StatusBar } from './StatusBar.js';
import { QueryEngine } from './QueryEngine.js';
import { TOOLS } from './tools.js';
import type { ChatMessage, ChatState, SupportedModel } from './types.js';

const SYSTEM_PROMPT = `你是 OpenWriter，一个专业的 AI 小说写作助手。

你可以帮助用户：
- 初始化写作项目 (init)
- 撰写章节、场景、对话 (write)
- 修订和润色文本 (revise)
- 检查连续性和一致性 (check)
- 构思剧情、角色、设定 (brainstorm)
- 切换工作目录 (cd)

根据用户的自然语言描述，选择合适的工具来完成任务。如果用户描述模糊，先询问澄清。`;

export function ChatInterface() {
  const { exit } = useApp();
  const [state, setState] = useState<ChatState>({
    mode: 'config',
    messages: [],
    input: '',
    currentTask: null,
    model: null,
    apiKey: null,
    workDir: process.cwd(),
    projectConfig: null,
  });
  
  const engineRef = useRef<QueryEngine | null>(null);

  // Handle model configuration
  const handleModelConfig = useCallback((model: string, apiKey: string) => {
    setState(prev => ({ ...prev, model: model as SupportedModel, apiKey, mode: 'directory' }));
  }, []);

  // Handle directory selection
  const handleDirectorySelect = useCallback((dir: string) => {
    setState(prev => ({ ...prev, workDir: dir }));
    
    // Initialize QueryEngine with the selected directory
    if (state.model && state.apiKey) {
      engineRef.current = new QueryEngine({
        model: state.model as SupportedModel,
        apiKey: state.apiKey,
        tools: TOOLS,
        maxIterations: 10,
        systemPrompt: SYSTEM_PROMPT,
      });
      
      setState(prev => ({
        ...prev,
        mode: 'chat',
        messages: [{
          role: 'assistant',
          content: `工作目录已设置为: ${dir}\n\n告诉我你想做什么，例如:\n- "init 我的科幻小说"\n- "写第一章，主角醒来发现世界变了"\n- "检查一下有没有逻辑漏洞"`,
          timestamp: Date.now(),
        }],
      }));
    }
  }, [state.model, state.apiKey]);

  // Handle user input - ReAct loop
  const handleInputSubmit = useCallback(async (input: string) => {
    if (!input.trim() || !engineRef.current) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };

    setState(prev => ({
      ...prev,
      mode: 'executing',
      messages: [...prev.messages, userMessage],
      input: '',
      currentTask: '思考中...',
    }));

    try {
      const response = await engineRef.current.process(
        input,
        // onStream
        (chunk) => {
          setState(prev => {
            const lastMsg = prev.messages[prev.messages.length - 1];
            if (lastMsg?.role === 'assistant') {
              return {
                ...prev,
                messages: [...prev.messages.slice(0, -1), {
                  ...lastMsg,
                  content: lastMsg.content + chunk,
                }],
              };
            }
            return {
              ...prev,
              messages: [...prev.messages, {
                role: 'assistant',
                content: chunk,
                timestamp: Date.now(),
              }],
            };
          });
        },
        // onToolCall
        (tool, args) => {
          setState(prev => ({ ...prev, currentTask: `执行: ${tool}` }));
        },
        // onToolResult
        (tool, result) => {
          setState(prev => ({ ...prev, currentTask: `${tool} 完成` }));
        },
        // onComplete
        () => {
          setState(prev => ({ ...prev, mode: 'chat', currentTask: null }));
        }
      );

    } catch (err) {
      setState(prev => ({
        ...prev,
        mode: 'chat',
        currentTask: null,
        messages: [...prev.messages, {
          role: 'assistant',
          content: `错误: ${err instanceof Error ? err.message : '未知错误'}`,
          timestamp: Date.now(),
        }],
      }));
    }
  }, []);

  // Global key handling
  useInput((input, key) => {
    if (key.escape && state.mode === 'chat') {
      exit();
    }
    if (key.ctrl && input === 'c') {
      exit();
    }
  }, { isActive: state.mode === 'chat' });

  // Config mode
  if (state.mode === 'config') {
    return <ModelConfig onConfig={handleModelConfig} />;
  }

  // Directory selection mode
  if (state.mode === 'directory') {
    return <DirectorySelector onSelect={handleDirectorySelect} currentDir={state.workDir} />;
  }

  // Chat mode
  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">OpenWriter</Text>
        {state.model && (
          <Box marginLeft={2}>
            <Text dimColor>模型: {state.model}</Text>
          </Box>
        )}
        <Box marginLeft={2}>
          <Text dimColor>目录: {state.workDir}</Text>
        </Box>
      </Box>

      {/* Messages */}
      <Box flexGrow={1} flexDirection="column" overflow="hidden">
        <MessageList messages={state.messages} />
      </Box>

      {/* Status bar */}
      {state.currentTask && (
        <StatusBar task={state.currentTask} executing={state.mode === 'executing'} />
      )}

      {/* Input */}
      <Box borderStyle="single" borderColor="cyan" paddingX={1} marginTop={1}>
        {state.mode === 'executing' ? (
          <Box>
            <Spinner type="dots" />
            <Text dimColor> 处理中...</Text>
          </Box>
        ) : (
          <TextInput
            value={state.input}
            onChange={(v) => setState(prev => ({ ...prev, input: v }))}
            onSubmit={handleInputSubmit}
            placeholder="输入指令或问题..."
          />
        )}
      </Box>

      {/* Help hint */}
      <Box marginTop={1}>
        <Text dimColor>Enter 发送 | ESC/Ctrl+C 退出</Text>
      </Box>
    </Box>
  );
}
import React from 'react';
import { Box, Text } from 'ink';
import type { ChatMessage } from './types.js';

interface MessageListProps {
  messages: ChatMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  // Only show last N messages to fit screen
  const visibleMessages = messages.slice(-20);

  return (
    <Box flexDirection="column" overflow="hidden">
      {visibleMessages.map((msg, index) => (
        <Box key={index} flexDirection="column" marginBottom={1}>
          {/* Role label */}
          <Box>
            <Text bold color={msg.role === 'user' ? 'green' : msg.role === 'tool' ? 'yellow' : 'cyan'}>
              {msg.role === 'user' ? '你' : msg.role === 'tool' ? `[Tool: ${msg.metadata?.toolName}]` : 'OpenWriter'}
            </Text>
            {msg.streaming && (
              <Text dimColor> (输出中...)</Text>
            )}
          </Box>
          
          {/* Content */}
          <Box marginLeft={2} flexDirection="column">
            {formatContent(msg.content)}
          </Box>
        </Box>
      ))}
      
      {messages.length === 0 && (
        <Box>
          <Text dimColor>开始对话吧...</Text>
        </Box>
      )}
    </Box>
  );
}

function formatContent(content: string): React.ReactNode {
  // Split by lines and render
  const lines = content.split('\n').slice(0, 50); // Limit lines
  
  return lines.map((line, i) => (
    <Text key={i}>{line || ' '}</Text>
  ));
}
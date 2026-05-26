import React from 'react';
import TextInput from 'ink-text-input';
import { Box, Text } from 'ink';

interface InputPromptProps {
  prompt: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

export function InputPrompt({ prompt, value, onChange, onSubmit }: InputPromptProps) {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color="cyan">{prompt}</Text>
      </Box>
      <Box borderStyle="single" borderColor="cyan" paddingX={1}>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder="输入后按 Enter 执行..."
        />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Enter 执行 | ESC 返回</Text>
      </Box>
    </Box>
  );
}
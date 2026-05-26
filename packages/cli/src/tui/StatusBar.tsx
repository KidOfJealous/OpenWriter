import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

interface StatusBarProps {
  task: string;
  executing: boolean;
}

export function StatusBar({ task, executing }: StatusBarProps) {
  return (
    <Box borderStyle="single" borderColor="yellow" paddingX={1}>
      {executing ? (
        <Box>
          <Spinner type="dots" />
          <Text color="yellow"> {task}</Text>
        </Box>
      ) : (
        <Text dimColor>{task}</Text>
      )}
    </Box>
  );
}
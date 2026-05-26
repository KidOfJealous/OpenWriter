import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

export interface AgentStatus {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  message?: string;
}

interface StatusBarProps {
  statuses: AgentStatus[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'gray',
  running: 'yellow',
  completed: 'green',
  error: 'red',
};

const STATUS_ICONS: Record<string, string> = {
  pending: '○',
  running: '◐',
  completed: '●',
  error: '✗',
};

export function StatusBar({ statuses }: StatusBarProps) {
  if (statuses.length === 0) {
    return (
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>准备执行...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold dimColor>Agent 状态:</Text>
      <Box flexDirection="column">
        {statuses.map(agent => (
          <Box key={agent.name} marginBottom={0}>
            <Box width={16}>
              <Text color={STATUS_COLORS[agent.status]}>
                {agent.status === 'running' ? (
                  <>
                    <Spinner type="dots" />
                    <Text> {agent.name}</Text>
                  </>
                ) : (
                  `${STATUS_ICONS[agent.status]} ${agent.name}`
                )}
              </Text>
            </Box>
            {agent.message && (
              <Text dimColor>{agent.message}</Text>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
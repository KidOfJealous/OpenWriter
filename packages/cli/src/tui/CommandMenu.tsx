import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface CommandItem {
  id: string;
  label: string;
  description: string;
  shortcut: string;
}

const COMMANDS: CommandItem[] = [
  { id: 'write', label: '写作', description: '撰写新章节或内容', shortcut: 'w' },
  { id: 'revise', label: '修订', description: '润色或改进现有文本', shortcut: 'r' },
  { id: 'check', label: '检查', description: '检查连续性与一致性', shortcut: 'c' },
  { id: 'style', label: '风格', description: '检查文风与语言', shortcut: 's' },
  { id: 'brainstorm', label: '头脑风暴', description: '构思剧情或设定', shortcut: 'b' },
  { id: 'plan', label: '规划', description: '规划章节结构', shortcut: 'p' },
  { id: 'init', label: '初始化', description: '初始化写作项目', shortcut: 'i' },
  { id: 'exit', label: '退出', description: '退出程序', shortcut: 'q' },
];

interface CommandMenuProps {
  onSelect: (command: string) => void;
}

export function CommandMenu({ onSelect }: CommandMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex(prev => (prev - 1 + COMMANDS.length) % COMMANDS.length);
    } else if (key.downArrow) {
      setSelectedIndex(prev => (prev + 1) % COMMANDS.length);
    } else if (key.return) {
      onSelect(COMMANDS[selectedIndex].id);
    } else {
      // Check shortcut keys
      const cmd = COMMANDS.find(c => c.shortcut === input.toLowerCase());
      if (cmd) {
        onSelect(cmd.id);
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>选择命令:</Text>
      </Box>
      
      {COMMANDS.map((cmd, index) => (
        <Box key={cmd.id} marginBottom={0}>
          <Box width={2}>
            {index === selectedIndex ? (
              <Text color="cyan">▸</Text>
            ) : (
              <Text dimColor> </Text>
            )}
          </Box>
          <Box width={12}>
            {index === selectedIndex ? (
              <Text bold color="cyan">{cmd.label}</Text>
            ) : (
              <Text>{cmd.label}</Text>
            )}
          </Box>
          <Box width={4}>
            <Text dimColor>[{cmd.shortcut}]</Text>
          </Box>
          <Text dimColor>{cmd.description}</Text>
        </Box>
      ))}
      
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>↑/↓ 选择 | Enter 执行 | 快捷键直接执行</Text>
      </Box>
    </Box>
  );
}
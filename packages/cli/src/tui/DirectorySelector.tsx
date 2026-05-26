import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { existsSync } from 'fs';
import { resolve } from 'path';

interface DirectorySelectorProps {
  onSelect: (dir: string) => void;
  currentDir: string;
}

export function DirectorySelector({ onSelect, currentDir }: DirectorySelectorProps) {
  const [mode, setMode] = useState<'browse' | 'input'>('browse');
  const [inputDir, setInputDir] = useState(currentDir);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // 常用目录选项
  const suggestions = [
    { path: currentDir, label: '当前目录' },
    { path: resolve(currentDir, '..'), label: '上级目录' },
    { path: resolve(currentDir, 'projects'), label: 'projects 子目录' },
    { path: resolve(currentDir, 'writing'), label: 'writing 子目录' },
  ];

  useInput((input, key) => {
    if (mode === 'browse') {
      if (key.upArrow) {
        setSelectedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
      } else if (key.downArrow) {
        setSelectedIndex(prev => (prev + 1) % suggestions.length);
      } else if (key.return) {
        onSelect(suggestions[selectedIndex].path);
      } else if (input === 'i' || input === 'I') {
        setMode('input');
      }
    }
  });

  if (mode === 'input') {
    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor="cyan" paddingX={1}>
          <Text bold color="cyan">选择工作目录</Text>
        </Box>
        
        <Box marginTop={1}>
          <Text>输入目录路径:</Text>
        </Box>
        
        <Box borderStyle="single" borderColor="cyan" paddingX={1} marginTop={1}>
          <TextInput
            value={inputDir}
            onChange={setInputDir}
            onSubmit={() => {
              if (existsSync(inputDir)) {
                onSelect(inputDir);
              }
            }}
            placeholder="输入目录路径..."
          />
        </Box>
        
        <Box marginTop={1}>
          <Text dimColor>Enter 确认 | ESC 返回浏览</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">选择工作目录</Text>
      </Box>
      
      <Box marginTop={1}>
        <Text>选择目录 (↑/↓ 选择，Enter 确认，i 手动输入):</Text>
      </Box>

      {suggestions.map((s, index) => (
        <Box key={s.path} marginLeft={1}>
          <Text color={index === selectedIndex ? 'cyan' : 'gray'}>
            {index === selectedIndex ? '▸ ' : '  '}
            {s.label}
          </Text>
          <Text dimColor> - {s.path}</Text>
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>或者按 'i' 手动输入路径</Text>
      </Box>
    </Box>
  );
}
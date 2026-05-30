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
  const [error, setError] = useState<string | null>(null);

  const suggestions = [
    { path: currentDir, label: 'current directory' },
    { path: resolve(currentDir, '..'), label: 'parent directory' },
    { path: resolve(currentDir, 'projects'), label: 'projects subdirectory' },
    { path: resolve(currentDir, 'writing'), label: 'writing subdirectory' },
  ];

  useInput((input, key) => {
    if (mode !== 'browse') {
      if (key.escape) {
        setMode('browse');
        setError(null);
      }
      return;
    }

    if (key.upArrow || input === 'k') {
      setSelectedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (key.downArrow || input === 'j') {
      setSelectedIndex(prev => (prev + 1) % suggestions.length);
    } else if (key.return) {
      onSelect(suggestions[selectedIndex].path);
    } else if (input === 'i' || input === 'I') {
      setMode('input');
      setError(null);
    }
  });

  if (mode === 'input') {
    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor="cyan" paddingX={1}>
          <Text bold color="cyan">Choose Workspace</Text>
        </Box>

        <Box marginTop={1}>
          <Text>Enter directory path:</Text>
        </Box>

        <Box borderStyle="single" borderColor={error ? 'red' : 'cyan'} paddingX={1} marginTop={1}>
          <TextInput
            value={inputDir}
            onChange={value => {
              setInputDir(value);
              setError(null);
            }}
            onSubmit={() => {
              if (existsSync(inputDir)) {
                onSelect(inputDir);
              } else {
                setError(`Directory not found: ${inputDir}`);
              }
            }}
            placeholder="Enter directory path..."
            showCursor={false}
          />
        </Box>

        {error && (
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>Enter to confirm, Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">Choose Workspace</Text>
      </Box>

      <Box marginTop={1}>
        <Text>Select directory: Up/Down or j/k, Enter to confirm, i to type a path</Text>
      </Box>

      {suggestions.map((item, index) => (
        <Box key={item.path} marginLeft={1}>
          <Text color={index === selectedIndex ? 'cyan' : 'gray'}>
            {index === selectedIndex ? '> ' : '  '}
            {item.label}
          </Text>
          <Text dimColor> - {item.path}</Text>
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>Press i to manually enter a workspace path.</Text>
      </Box>
    </Box>
  );
}

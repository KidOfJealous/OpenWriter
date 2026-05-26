import React, { useMemo } from 'react';
import { Box, Text } from 'ink';

interface OutputDisplayProps {
  content: string;
  maxHeight?: number;
}

export function OutputDisplay({ content, maxHeight = 15 }: OutputDisplayProps) {
  // Split content into lines and limit to maxHeight
  const lines = useMemo(() => {
    const allLines = content.split('\n');
    if (allLines.length > maxHeight) {
      return allLines.slice(-maxHeight);
    }
    return allLines;
  }, [content, maxHeight]);

  const isTruncated = content.split('\n').length > maxHeight;

  return (
    <Box 
      flexDirection="column" 
      borderStyle="single" 
      borderColor="gray"
      paddingX={1}
      minHeight={Math.min(lines.length, maxHeight)}
    >
      {isTruncated && (
        <Text dimColor>... (显示最近 {maxHeight} 行)</Text>
      )}
      {lines.map((line, index) => (
        <Text key={index}>{line || ' '}</Text>
      ))}
    </Box>
  );
}
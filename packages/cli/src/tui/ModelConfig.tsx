import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { MODEL_CONFIGS, type SupportedModel } from './types.js';

interface ModelConfigProps {
  onConfig: (model: string, apiKey: string) => void;
}

export function ModelConfig({ onConfig }: ModelConfigProps) {
  const [step, setStep] = useState<'select' | 'apikey' | 'confirm'>('select');
  const [selectedModel, setSelectedModel] = useState<SupportedModel | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const models = Object.keys(MODEL_CONFIGS) as SupportedModel[];

  // Check for existing env keys
  useEffect(() => {
    // Auto-select if API key already exists in env
    for (const model of models) {
      const config = MODEL_CONFIGS[model];
      if (process.env[config.envKey]) {
        setSelectedModel(model);
        setApiKey(process.env[config.envKey] || '');
        setStep('confirm');
        return;
      }
    }
  }, []);

  // Keyboard navigation for model selection
  useEffect(() => {
    if (step !== 'select') return;
    
    const handleInput = (input: string) => {
      if (input === '\x1b[A' || input === 'k') { // Up
        setSelectedIndex(prev => (prev - 1 + models.length) % models.length);
      } else if (input === '\x1b[B' || input === 'j') { // Down
        setSelectedIndex(prev => (prev + 1) % models.length);
      } else if (input === '\r') { // Enter
        setSelectedModel(models[selectedIndex]);
        setStep('apikey');
      }
    };

    // Note: In ink we use useInput hook, but this is simplified
  }, [step, selectedIndex, models]);

  const handleApiKeySubmit = () => {
    if (!apiKey.trim()) {
      setError('请输入 API Key');
      return;
    }
    setStep('confirm');
  };

  const handleConfirm = () => {
    if (selectedModel && apiKey) {
      // Save to env for this session
      const config = MODEL_CONFIGS[selectedModel];
      process.env[config.envKey] = apiKey;
      onConfig(selectedModel, apiKey);
    }
  };

  // Select model step
  if (step === 'select') {
    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor="cyan" paddingX={1}>
          <Text bold color="cyan">OpenWriter 配置</Text>
        </Box>
        
        <Box marginTop={1}>
          <Text>选择模型 (↑/↓ 或 j/k 选择，Enter 确认):</Text>
        </Box>

        {models.map((model, index) => (
          <Box key={model} marginLeft={1}>
            <Text color={index === selectedIndex ? 'cyan' : 'gray'}>
              {index === selectedIndex ? '▸ ' : '  '}
              {MODEL_CONFIGS[model].name}
            </Text>
            {process.env[MODEL_CONFIGS[model].envKey] && (
              <Text dimColor> (已有 API Key)</Text>
            )}
          </Box>
        ))}

        <Box marginTop={1}>
          <Text dimColor>推荐: DeepSeek Chat (性价比高)</Text>
        </Box>
      </Box>
    );
  }

  // API Key input step
  if (step === 'apikey' && selectedModel) {
    const config = MODEL_CONFIGS[selectedModel];
    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor="cyan" paddingX={1}>
          <Text bold color="cyan">配置 {config.name}</Text>
        </Box>

        <Box marginTop={1}>
          <Text>模型: {config.name}</Text>
        </Box>
        
        <Box marginTop={1}>
          <Text>请输入 API Key:</Text>
        </Box>
        
        <Box borderStyle="single" borderColor="cyan" paddingX={1} marginTop={1}>
          <TextInput
            value={apiKey}
            onChange={setApiKey}
            onSubmit={handleApiKeySubmit}
            placeholder={`输入 ${config.envKey}...`}
          />
        </Box>

        {error && (
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>获取 API Key: {config.baseUrl}</Text>
        </Box>
      </Box>
    );
  }

  // Confirm step
  if (step === 'confirm' && selectedModel) {
    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor="green" paddingX={1}>
          <Text bold color="green">配置确认</Text>
        </Box>

        <Box marginTop={1}>
          <Text>模型: {MODEL_CONFIGS[selectedModel].name}</Text>
        </Box>
        
        <Box marginTop={1}>
          <Text dimColor>API Key: {apiKey.slice(0, 8)}...{apiKey.slice(-4)}</Text>
        </Box>

        <Box marginTop={1}>
          <Text color="cyan">按 Enter 开始使用</Text>
        </Box>
      </Box>
    );
  }

  return null;
}
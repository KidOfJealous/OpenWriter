import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import {
  MODEL_PROVIDERS,
  type ModelProviderPreset,
  type ModelRuntimeConfig,
  type ProviderModel,
} from './types.js';

interface ModelConfigProps {
  onConfig: (config: ModelRuntimeConfig) => void;
  onCancel?: () => void;
  canCancel?: boolean;
}

type FocusPane = 'providers' | 'models';
type PromptStep = 'picker' | 'apiKey' | 'customModel' | 'customBaseUrl' | 'customApiKey';

export function ModelConfig({ onConfig, onCancel, canCancel = false }: ModelConfigProps) {
  const [step, setStep] = useState<PromptStep>('picker');
  const [focus, setFocus] = useState<FocusPane>('providers');
  const [providerIndex, setProviderIndex] = useState(0);
  const [modelIndex, setModelIndex] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const provider = MODEL_PROVIDERS[providerIndex];
  const selectedModel = provider.models[Math.min(modelIndex, provider.models.length - 1)];

  useInput((input, key) => {
    if (key.escape) {
      setError(null);
      if (step === 'customApiKey') {
        setStep('customBaseUrl');
      } else if (step === 'customBaseUrl') {
        setStep('customModel');
      } else if (step === 'customModel' || step === 'apiKey') {
        setStep('picker');
      } else if (canCancel && onCancel) {
        onCancel();
      } else {
        setError('Configure a provider first, or press Ctrl+C to quit.');
      }
      return;
    }

    if (step !== 'picker') return;

    if (key.tab || key.leftArrow || key.rightArrow) {
      setFocus(prev => prev === 'providers' ? 'models' : 'providers');
      setError(null);
      return;
    }

    if (key.upArrow || input === 'k') {
      if (focus === 'providers') {
        setProviderIndex(prev => {
          const next = (prev - 1 + MODEL_PROVIDERS.length) % MODEL_PROVIDERS.length;
          setModelIndex(0);
          return next;
        });
      } else {
        setModelIndex(prev => (prev - 1 + provider.models.length) % provider.models.length);
      }
      setError(null);
      return;
    }

    if (key.downArrow || input === 'j') {
      if (focus === 'providers') {
        setProviderIndex(prev => {
          const next = (prev + 1) % MODEL_PROVIDERS.length;
          setModelIndex(0);
          return next;
        });
      } else {
        setModelIndex(prev => (prev + 1) % provider.models.length);
      }
      setError(null);
      return;
    }

    if (key.return) {
      if (focus === 'providers') {
        setFocus('models');
        setError(null);
      } else {
        chooseModel(provider, selectedModel);
      }
    }
  });

  const chooseModel = (selectedProvider: ModelProviderPreset, model: ProviderModel) => {
    if (selectedProvider.custom) {
      setCustomModel('');
      setCustomBaseUrl('');
      setCustomApiKey('');
      setStep('customModel');
      return;
    }

    const envValue = selectedProvider.envKey ? process.env[selectedProvider.envKey] : undefined;
    if (selectedProvider.apiKeyRequired && !envValue) {
      setApiKey('');
      setStep('apiKey');
      return;
    }

    applyConfig(selectedProvider, model.id, envValue);
  };

  const applyConfig = (selectedProvider: ModelProviderPreset, model: string, key?: string) => {
    if (selectedProvider.envKey && key) {
      process.env[selectedProvider.envKey] = key;
    }

    onConfig({
      provider: selectedProvider.provider,
      model,
      baseUrl: selectedProvider.baseUrl,
      apiKey: key,
      envKey: selectedProvider.envKey,
      displayName: `${selectedProvider.name} / ${model}`,
    });
  };

  if (step === 'customModel') {
    return (
      <PromptInput
        title="Custom Model"
        label="Model ID"
        value={customModel}
        onChange={value => {
          setCustomModel(value);
          setError(null);
        }}
        onSubmit={() => {
          if (!customModel.trim()) {
            setError('Enter a model id.');
            return;
          }
          setStep('customBaseUrl');
        }}
        placeholder="model-id"
        error={error}
      />
    );
  }

  if (step === 'customBaseUrl') {
    return (
      <PromptInput
        title="Custom Base URL"
        label="OpenAI-compatible base URL"
        value={customBaseUrl}
        onChange={value => {
          setCustomBaseUrl(value);
          setError(null);
        }}
        onSubmit={() => {
          const cleaned = normalizeCustomBaseUrl(customBaseUrl);
          if (!/^https?:\/\//i.test(cleaned)) {
            setError('Base URL must start with http:// or https://.');
            return;
          }
          setCustomBaseUrl(cleaned);
          setStep('customApiKey');
        }}
        placeholder="https://api.example.com"
        error={error}
      />
    );
  }

  if (step === 'customApiKey') {
    return (
      <PromptInput
        title="Custom API Key"
        label="API key"
        value={customApiKey}
        onChange={value => {
          setCustomApiKey(value);
          setError(null);
        }}
        onSubmit={() => {
          const model = customModel.trim();
          const baseUrl = normalizeCustomBaseUrl(customBaseUrl);
          const key = customApiKey.trim();
          if (!key) {
            setError('Paste an API key.');
            return;
          }
          process.env.OPENAI_API_KEY = key;
          onConfig({
            provider: 'openai-compatible',
            model,
            baseUrl,
            apiKey: key,
            envKey: 'OPENAI_API_KEY',
            displayName: `Custom / ${model}`,
          });
        }}
        placeholder="Paste API key..."
        error={error}
        mask
      />
    );
  }

  if (step === 'apiKey') {
    return (
      <PromptInput
        title={`${provider.name} API Key`}
        label={`Env var: ${provider.envKey}`}
        value={apiKey}
        onChange={value => {
          setApiKey(value);
          setError(null);
        }}
        onSubmit={() => {
          const key = apiKey.trim();
          if (!key) {
            setError(`Paste a key or set ${provider.envKey}.`);
            return;
          }
          applyConfig(provider, selectedModel.id, key);
        }}
        placeholder="Paste API key..."
        error={error}
        mask
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">Model Picker</Text>
        <Text dimColor>{'  DeepSeek preset or custom compatible endpoint.'}</Text>
      </Box>

      <Box marginTop={1} flexDirection="row">
        <Box borderStyle="round" borderColor={focus === 'providers' ? 'cyan' : 'gray'} paddingX={1} width="42%" flexDirection="column">
          <Text bold color={focus === 'providers' ? 'cyan' : 'white'}>Providers</Text>
          {MODEL_PROVIDERS.map((item, index) => (
            <ProviderRow
              key={item.id}
              provider={item}
              selected={index === providerIndex}
              focused={focus === 'providers'}
            />
          ))}
        </Box>

        <Box borderStyle="round" borderColor={focus === 'models' ? 'cyan' : 'gray'} paddingX={1} marginLeft={1} width="58%" flexDirection="column">
          <Text bold color={focus === 'models' ? 'cyan' : 'white'}>Models</Text>
          {provider.models.map((model, index) => (
            <ModelRow
              key={model.id}
              model={model}
              selected={index === modelIndex}
              focused={focus === 'models'}
            />
          ))}
        </Box>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>{provider.description}</Text>
        {provider.custom ? (
          <Text dimColor>Custom asks for model, base URL, and API key.</Text>
        ) : (
          <Text dimColor>
            {provider.apiKeyRequired
              ? `API key: ${provider.envKey}${envKeyValue(provider) ? ' found' : ' will be requested'}`
              : 'No API key required.'}
          </Text>
        )}
        {error ? <Text color="red">{error}</Text> : <Text dimColor>Tab switches pane, Enter selects, Esc cancels.</Text>}
      </Box>
    </Box>
  );
}

function ProviderRow({
  provider,
  selected,
  focused,
}: {
  provider: ModelProviderPreset;
  selected: boolean;
  focused: boolean;
}) {
  const color = selected && focused ? 'cyan' : selected ? 'white' : 'gray';
  const envOk = provider.envKey && process.env[provider.envKey];

  return (
    <Box>
      <Text color={color}>{selected && focused ? '> ' : '  '}{provider.name}</Text>
      {envOk ? <Text color="green"> env</Text> : null}
    </Box>
  );
}

function ModelRow({
  model,
  selected,
  focused,
}: {
  model: ProviderModel;
  selected: boolean;
  focused: boolean;
}) {
  const color = selected && focused ? 'cyan' : selected ? 'white' : 'gray';

  return (
    <Box>
      <Text color={color}>{selected && focused ? '> ' : '  '}{model.name}</Text>
      <Text dimColor>  {model.id}</Text>
    </Box>
  );
}

function PromptInput({
  title,
  label,
  value,
  onChange,
  onSubmit,
  placeholder,
  error,
  mask = false,
}: {
  title: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  error: string | null;
  mask?: boolean;
}) {
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">{title}</Text>
      </Box>

      <Box marginTop={1}>
        <Text>{label}</Text>
      </Box>

      <Box borderStyle="single" borderColor={error ? 'red' : 'cyan'} paddingX={1} marginTop={1}>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={placeholder}
          mask={mask ? '*' : undefined}
          showCursor={false}
        />
      </Box>

      {error && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>Esc goes back.</Text>
      </Box>
    </Box>
  );
}

function envKeyValue(provider: ModelProviderPreset): string {
  return provider.envKey ? process.env[provider.envKey] ?? '' : '';
}

function normalizeCustomBaseUrl(baseUrl: string): string {
  return baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1\/chat\/completions$/i, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/v1$/i, '');
}

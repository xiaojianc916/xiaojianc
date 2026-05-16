import {
  DEFAULT_MASTRA_BASE_URL,
  DEFAULT_MASTRA_MODEL_ID,
  findAiServicePlatformByModel,
} from '@/constants/ai-providers';
import type {
  IAiConfigPayload,
  IAiModelEndpointConfigPayload,
  TAiModelRole,
  TAiProviderType,
} from '@/types/ai';

const DEFAULT_PROVIDER_TYPE: TAiProviderType = 'mastra';
const DEFAULT_NARRATOR_MODEL_ID = 'zhipuai/glm-4.7-flash';

export const createDefaultAiModelEndpointConfig = (
  selectedModel = DEFAULT_MASTRA_MODEL_ID,
): IAiModelEndpointConfigPayload => {
  const platform = findAiServicePlatformByModel(selectedModel);
  return {
  providerType: DEFAULT_PROVIDER_TYPE,
  selectedModel,
  baseUrl: platform.baseUrl || DEFAULT_MASTRA_BASE_URL || null,
  activeProfileId: null,
  isBaseUrlConfigured: true,
  hasCredentials: false,
  isConfigured: false,
  };
};

export const createDefaultAiConfigPayload = (): IAiConfigPayload => ({
  providerType: DEFAULT_PROVIDER_TYPE,
  selectedModel: DEFAULT_MASTRA_MODEL_ID,
  baseUrl: DEFAULT_MASTRA_BASE_URL || null,
  activeProfileId: null,
  isBaseUrlConfigured: true,
  hasCredentials: false,
  isConfigured: false,
  inlineCompletionEnabled: false,
  chatEnabled: true,
  agentEnabled: false,
  narrator: createDefaultAiModelEndpointConfig(DEFAULT_NARRATOR_MODEL_ID),
});

export const cloneAiConfigPayload = (
  config: IAiConfigPayload,
): IAiConfigPayload => ({
  ...config,
  narrator: { ...config.narrator },
});

export const getAiModelEndpointConfig = (
  config: IAiConfigPayload,
  role: TAiModelRole,
): IAiModelEndpointConfigPayload => {
  if (role === 'narrator') {
    return config.narrator;
  }

  return {
    providerType: config.providerType,
    selectedModel: config.selectedModel,
    baseUrl: config.baseUrl,
    activeProfileId: config.activeProfileId,
    isBaseUrlConfigured: config.isBaseUrlConfigured,
    hasCredentials: config.hasCredentials,
    isConfigured: config.isConfigured,
  };
};

export const patchAiModelEndpointConfig = (
  config: IAiConfigPayload,
  role: TAiModelRole,
  patch: Partial<Pick<IAiModelEndpointConfigPayload, 'providerType' | 'selectedModel' | 'baseUrl'>>,
): void => {
  if (role === 'narrator') {
    config.narrator = {
      ...config.narrator,
      ...patch,
    };
    return;
  }

  if (patch.providerType !== undefined) {
    config.providerType = patch.providerType;
  }
  if (patch.selectedModel !== undefined) {
    config.selectedModel = patch.selectedModel;
  }
  if (patch.baseUrl !== undefined) {
    config.baseUrl = patch.baseUrl;
  }
};

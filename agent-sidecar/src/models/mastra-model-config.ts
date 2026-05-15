import {
  getProviderConfig,
  ModelRouterLanguageModel,
  parseModelString,
  type MastraModelConfig,
  type MastraModelGateway,
} from '@mastra/core/llm';

import {
  AGENT_SIDECAR_DEEPSEEK_PROVIDER_ID,
  createDeepSeekGatewayModelId,
  createDeepSeekMastraGateway,
} from './deepseek-mastra-gateway.js';

const MODEL_ID_ENV = 'AGENT_SIDECAR_MODEL';
const API_KEY_ENV = 'AGENT_SIDECAR_API_KEY';
const BASE_URL_ENV = 'AGENT_SIDECAR_BASE_URL';

const DEFAULT_MODEL_ID = 'deepseek/deepseek-v4-flash';

const readEnv = (
  key: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null => {
  const value = env[key]?.trim();
  return value ? value : null;
};

const normalizeBaseUrl = (value: string): string =>
  value.trim().replace(/\/+$/u, '');

const assertValidUrl = (value: string, source: string): string => {
  try {
    new URL(value);
  } catch {
    throw new Error(`[mastra-model-config] ${source} 不是合法的 URL: "${value}"`);
  }

  return value;
};

const resolveProviderModelId = (modelId: string): {
  providerId: string;
  providerModelId: string;
} => {
  const parsed = parseModelString(modelId);
  const providerId = parsed.provider?.trim();
  const providerModelId = parsed.modelId.trim();

  if (!providerId || !providerModelId) {
    throw new Error(
      `[mastra-model-config] 模型标识必须使用 provider/model 形式，当前收到：${modelId}`,
    );
  }

  return {
    providerId,
    providerModelId,
  };
};

const resolveProviderBaseUrl = (
  providerId: string,
  explicitBaseUrl: string | null,
): string | undefined => {
  const rawBaseUrl = explicitBaseUrl ?? getProviderConfig(providerId)?.url?.trim();

  if (!rawBaseUrl) {
    return undefined;
  }

  return assertValidUrl(normalizeBaseUrl(rawBaseUrl), BASE_URL_ENV);
};

const createCustomGateways = (options: {
  providerId: string;
  apiKey: string;
  baseUrl?: string | undefined;
}): MastraModelGateway[] => {
  if (options.providerId !== AGENT_SIDECAR_DEEPSEEK_PROVIDER_ID) {
    return [];
  }

  return [
    createDeepSeekMastraGateway({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
    }),
  ];
};

const createMastraModel = (options: {
  providerId: string;
  providerModelId: string;
  apiKey: string;
  baseUrl?: string | undefined;
  customGateways: MastraModelGateway[];
}): MastraModelConfig => {
  if (options.providerId === AGENT_SIDECAR_DEEPSEEK_PROVIDER_ID) {
    return new ModelRouterLanguageModel(
      createDeepSeekGatewayModelId(options.providerModelId),
      options.customGateways,
    );
  }

  return new ModelRouterLanguageModel({
    providerId: options.providerId,
    modelId: options.providerModelId,
    ...(options.baseUrl ? { url: options.baseUrl } : {}),
    apiKey: options.apiKey,
  }, options.customGateways);
};

export interface ICreateMastraOpenAICompatibleModelConfigOptions {
  modelId: string;
  apiKey: string;
  baseUrl?: string | undefined;
}

export interface IMastraResolvedModelConfig {
  modelId: string;
  providerId: string;
  providerModelId: string;
  model: MastraModelConfig;
  customGateways: MastraModelGateway[];
}

export const createMastraOpenAICompatibleModelConfig = (
  options: ICreateMastraOpenAICompatibleModelConfigOptions,
): IMastraResolvedModelConfig => {
  const normalizedModelId = options.modelId.trim();
  if (!normalizedModelId) {
    throw new Error('[mastra-model-config] modelId 不能为空。');
  }

  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new Error('[mastra-model-config] apiKey 不能为空。');
  }

  const {
    providerId,
    providerModelId,
  } = resolveProviderModelId(normalizedModelId);
  const baseUrl = resolveProviderBaseUrl(providerId, options.baseUrl?.trim() ?? null);
  const customGateways = createCustomGateways({
    providerId,
    apiKey,
    baseUrl,
  });

  return {
    modelId: normalizedModelId,
    providerId,
    providerModelId,
    model: createMastraModel({
      providerId,
      providerModelId,
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
      customGateways,
    }),
    customGateways,
  };
};

export const createMastraModelConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): IMastraResolvedModelConfig | null => {
  const apiKey = readEnv(API_KEY_ENV, env);
  if (!apiKey) {
    return null;
  }

  return createMastraOpenAICompatibleModelConfig({
    modelId: readEnv(MODEL_ID_ENV, env) ?? DEFAULT_MODEL_ID,
    apiKey,
    baseUrl: readEnv(BASE_URL_ENV, env) ?? undefined,
  });
};

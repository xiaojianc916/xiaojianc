import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  MastraModelGateway,
  type GatewayLanguageModel,
  type ProviderConfig,
} from '@mastra/core/llm';

import { deepseekReasoningFetch } from './deepseek-reasoning-fetch.js';

const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

const normalizeBaseUrl = (value: string): string =>
  value.trim().replace(/\/+$/u, '');

const assertValidUrl = (value: string, source: string): string => {
  try {
    new URL(value);
  } catch {
    throw new Error(`[deepseek-mastra-gateway] ${source} 不是合法的 URL: "${value}"`);
  }

  return value;
};

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export interface IDeepSeekMastraGatewayOptions {
  apiKey: string;
  baseUrl?: string | undefined;
  models?: string[] | undefined;
}

export const AGENT_SIDECAR_MASTRA_GATEWAY_ID = 'agent-sidecar' as const;
export const AGENT_SIDECAR_DEEPSEEK_PROVIDER_ID = 'deepseek' as const;

const DEFAULT_DEEPSEEK_MODELS = [
  'deepseek-chat',
  'deepseek-reasoner',
  'deepseek-v3',
  'deepseek-v3.1',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
] as const;

const buildGatewayProviderModelId = (providerId: string, modelId: string): string =>
  `${AGENT_SIDECAR_MASTRA_GATEWAY_ID}/${providerId}/${modelId}`;

export class DeepSeekMastraGateway extends MastraModelGateway {
  readonly id = AGENT_SIDECAR_MASTRA_GATEWAY_ID;
  readonly name = 'Agent Sidecar Gateway';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly models: readonly string[];

  constructor(options: IDeepSeekMastraGatewayOptions) {
    super();

    const apiKey = options.apiKey.trim();
    if (!apiKey) {
      throw new Error('[deepseek-mastra-gateway] apiKey 不能为空。');
    }

    this.apiKey = apiKey;
    this.baseUrl = assertValidUrl(
      normalizeBaseUrl(options.baseUrl?.trim() || DEFAULT_DEEPSEEK_BASE_URL),
      'baseUrl',
    );
    this.models = options.models?.length
      ? [...new Set(options.models.map((model) => model.trim()).filter(Boolean))]
      : DEFAULT_DEEPSEEK_MODELS;
  }

  async fetchProviders(): Promise<Record<string, ProviderConfig>> {
    return {
      [AGENT_SIDECAR_DEEPSEEK_PROVIDER_ID]: {
        url: this.baseUrl,
        apiKeyEnvVar: 'AGENT_SIDECAR_API_KEY',
        apiKeyHeader: 'Authorization',
        name: 'DeepSeek',
        models: [...this.models],
        gateway: this.id,
      },
    };
  }

  override buildUrl(modelId: string, _envVars: Record<string, string> = {}): string | undefined {
    const normalizedModelId = modelId.trim();
    const gatewayPrefix = `${this.id}/${AGENT_SIDECAR_DEEPSEEK_PROVIDER_ID}/`;

    if (
      normalizedModelId === AGENT_SIDECAR_DEEPSEEK_PROVIDER_ID
      || normalizedModelId.startsWith(gatewayPrefix)
      || normalizedModelId.startsWith(`${AGENT_SIDECAR_DEEPSEEK_PROVIDER_ID}/`)
    ) {
      return this.baseUrl;
    }

    return undefined;
  }

  override async getApiKey(_modelId: string): Promise<string> {
    return this.apiKey;
  }

  override async resolveLanguageModel(args: {
    modelId: string;
    providerId: string;
    apiKey: string;
    headers?: Record<string, string>;
  }): Promise<GatewayLanguageModel> {
    if (args.providerId !== AGENT_SIDECAR_DEEPSEEK_PROVIDER_ID) {
      throw new Error(
        `[deepseek-mastra-gateway] 不支持的 provider: ${args.providerId}`,
      );
    }

    return createOpenAICompatible({
      name: args.providerId,
      apiKey: toNonEmptyString(args.apiKey) ?? this.apiKey,
      baseURL: this.baseUrl,
      ...(args.headers ? { headers: args.headers } : {}),
      fetch: deepseekReasoningFetch,
      supportsStructuredOutputs: true,
    }).chatModel(args.modelId);
  }

  override serializeForSpan(): { id: string; name: string } {
    return {
      id: this.id,
      name: this.name,
    };
  }
}

export const createDeepSeekMastraGateway = (
  options: IDeepSeekMastraGatewayOptions,
): DeepSeekMastraGateway => new DeepSeekMastraGateway(options);

export const createDeepSeekGatewayModelId = (modelId: string): string =>
  buildGatewayProviderModelId(AGENT_SIDECAR_DEEPSEEK_PROVIDER_ID, modelId);

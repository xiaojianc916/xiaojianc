import OpenAI from 'openai';
import {
  Model,
  type BaseModelConfig,
  type JSONValue,
  type Message,
  type ModelStreamEvent,
  type StreamOptions,
  type SystemPrompt,
  type ToolChoice,
  type ToolSpec,
} from '@strands-agents/sdk';

export interface IOpenAiChatCompatModelConfig extends BaseModelConfig {
  apiKey: string;
  baseUrl: string;
  modelId: string;
  sendReasoningContent?: boolean;
}

type TChatAssistantMessage = OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam & {
  reasoning_content?: string | null;
};

type TChatMessage =
  | OpenAI.Chat.Completions.ChatCompletionMessageParam
  | TChatAssistantMessage;

type TChatRequest = Omit<
  OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
  'messages'
> & {
  messages: TChatMessage[];
};

type TActiveBlock = 'reasoning' | 'text' | null;

export interface IOpenAiChatStreamState {
  hasMessageStarted: boolean;
  activeBlock: TActiveBlock;
  activeToolCallIndexes: Set<number>;
}

const EMPTY_TOOL_RESULT_TEXT = 'Tool completed successfully with no output.';

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const readString = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key];

  return typeof value === 'string' ? value : null;
};

const readNumber = (record: Record<string, unknown>, key: string): number | null => {
  const value = record[key];

  return typeof value === 'number' ? value : null;
};

const readArray = (record: Record<string, unknown>, key: string): unknown[] => {
  const value = record[key];

  return Array.isArray(value) ? value : [];
};

const stringifyJsonValue = (value: JSONValue): string => {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return error instanceof Error
      ? `[JSON serialization failed: ${error.message}]`
      : '[JSON serialization failed]';
  }
};

const stringifyToolInput = (value: JSONValue): string => {
  const serialized = stringifyJsonValue(value);

  return serialized.length > 0 ? serialized : '{}';
};

const normalizeToolResultText = (value: string): string => {
  const normalized = value.trim();

  return normalized.length > 0 ? normalized : EMPTY_TOOL_RESULT_TEXT;
};

const stopReasonFromFinishReason = (finishReason: string): string => {
  const knownReasons: Record<string, string> = {
    stop: 'endTurn',
    tool_calls: 'toolUse',
    length: 'maxTokens',
    content_filter: 'contentFiltered',
  };

  return knownReasons[finishReason] ?? finishReason.replace(/_([a-z])/gu, (_, letter: string) =>
    letter.toUpperCase());
};

const shouldSendReasoningForModel = (config: IOpenAiChatCompatModelConfig): boolean => {
  if (config.sendReasoningContent === true) {
    return true;
  }

  const modelId = config.modelId.toLowerCase();
  const baseUrl = config.baseUrl.toLowerCase();

  return modelId.includes('deepseek') || baseUrl.includes('deepseek');
};

const systemPromptToText = (systemPrompt: SystemPrompt | undefined): string | null => {
  if (systemPrompt === undefined) {
    return null;
  }

  if (typeof systemPrompt === 'string') {
    const trimmed = systemPrompt.trim();

    return trimmed.length > 0 ? trimmed : null;
  }

  const text = systemPrompt
    .filter((block) => block.type === 'textBlock')
    .map((block) => block.text)
    .join('')
    .trim();

  return text.length > 0 ? text : null;
};

const createToolChoice = (
  toolChoice: ToolChoice | undefined,
): OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined => {
  if (!toolChoice) {
    return undefined;
  }

  if ('auto' in toolChoice) {
    return 'auto';
  }

  if ('any' in toolChoice) {
    return 'required';
  }

  return {
    type: 'function',
    function: {
      name: toolChoice.tool.name,
    },
  };
};

const createToolDefinitions = (
  toolSpecs: ToolSpec[] | undefined,
): OpenAI.Chat.Completions.ChatCompletionTool[] | undefined => {
  if (!toolSpecs?.length) {
    return undefined;
  }

  return toolSpecs.map((spec) => {
    const parameters = toRecord(spec.inputSchema) ?? undefined;

    return {
      type: 'function',
      function: {
        name: spec.name,
        description: spec.description,
        ...(parameters ? { parameters } : {}),
      },
    };
  });
};

const toolResultBlockToText = (
  block: Extract<Message['content'][number], { type: 'toolResultBlock' }>,
): string => {
  const parts: string[] = [];

  for (const content of block.content) {
    switch (content.type) {
      case 'textBlock':
        parts.push(content.text);
        break;
      case 'jsonBlock':
        parts.push(stringifyJsonValue(content.json));
        break;
      case 'imageBlock':
        parts.push('[Tool returned an image result.]');
        break;
      case 'documentBlock':
        parts.push('[Tool returned a document result.]');
        break;
      case 'videoBlock':
        parts.push('[Tool returned a video result.]');
        break;
      default:
        break;
    }
  }

  return normalizeToolResultText(parts.join(''));
};

const formatUserMessage = (message: Message): TChatMessage[] => {
  const messages: TChatMessage[] = [];
  const textParts: string[] = [];

  for (const block of message.content) {
    if (block.type === 'toolResultBlock') {
      const content = toolResultBlockToText(block);
      messages.push({
        role: 'tool',
        tool_call_id: block.toolUseId,
        content: block.status === 'error' ? `[ERROR] ${content}` : content,
      });
    } else if (block.type === 'textBlock') {
      textParts.push(block.text);
    }
  }

  const text = textParts.join('').trim();
  if (text.length > 0) {
    messages.unshift({
      role: 'user',
      content: text,
    });
  }

  return messages;
};

const formatAssistantMessage = (
  message: Message,
  shouldSendReasoningContent: boolean,
): TChatMessage[] => {
  const textParts: string[] = [];
  const reasoningParts: string[] = [];
  const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];

  for (const block of message.content) {
    switch (block.type) {
      case 'textBlock':
        textParts.push(block.text);
        break;
      case 'reasoningBlock':
        if (shouldSendReasoningContent && block.text) {
          reasoningParts.push(block.text);
        }
        break;
      case 'toolUseBlock':
        toolCalls.push({
          id: block.toolUseId,
          type: 'function',
          function: {
            name: block.name,
            arguments: stringifyToolInput(block.input),
          },
        });
        break;
      default:
        break;
    }
  }

  const content = textParts.join('').trim();
  const reasoningContent = reasoningParts.join('').trim();

  if (content.length === 0 && reasoningContent.length === 0 && toolCalls.length === 0) {
    return [];
  }

  return [{
    role: 'assistant',
    content,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    ...(reasoningContent.length > 0 ? { reasoning_content: reasoningContent } : {}),
  }];
};

export const formatMessagesForOpenAiChat = (
  messages: Message[],
  shouldSendReasoningContent: boolean,
): TChatMessage[] =>
  messages.flatMap((message) => message.role === 'user'
    ? formatUserMessage(message)
    : formatAssistantMessage(message, shouldSendReasoningContent));

const ensureMessageStarted = (
  state: IOpenAiChatStreamState,
  events: ModelStreamEvent[],
): void => {
  if (state.hasMessageStarted) {
    return;
  }

  state.hasMessageStarted = true;
  events.push({
    type: 'modelMessageStartEvent',
    role: 'assistant',
  });
};

const closeActiveBlock = (
  state: IOpenAiChatStreamState,
  events: ModelStreamEvent[],
): void => {
  if (!state.activeBlock) {
    return;
  }

  events.push({
    type: 'modelContentBlockStopEvent',
  });
  state.activeBlock = null;
};

const ensureActiveBlock = (
  state: IOpenAiChatStreamState,
  events: ModelStreamEvent[],
  block: Exclude<TActiveBlock, null>,
): void => {
  ensureMessageStarted(state, events);

  if (state.activeBlock === block) {
    return;
  }

  closeActiveBlock(state, events);
  state.activeBlock = block;
  events.push({
    type: 'modelContentBlockStartEvent',
  });
};

const appendTextDelta = (
  state: IOpenAiChatStreamState,
  events: ModelStreamEvent[],
  text: string | null,
): void => {
  if (!text || text.length === 0) {
    return;
  }

  ensureActiveBlock(state, events, 'text');
  events.push({
    type: 'modelContentBlockDeltaEvent',
    delta: {
      type: 'textDelta',
      text,
    },
  });
};

const appendReasoningDelta = (
  state: IOpenAiChatStreamState,
  events: ModelStreamEvent[],
  text: string | null,
): boolean => {
  if (!text || text.length === 0) {
    return false;
  }

  ensureActiveBlock(state, events, 'reasoning');
  events.push({
    type: 'modelContentBlockDeltaEvent',
    delta: {
      type: 'reasoningContentDelta',
      text,
    },
  });

  return true;
};

const appendToolCallDelta = (
  state: IOpenAiChatStreamState,
  events: ModelStreamEvent[],
  rawToolCall: unknown,
): void => {
  const toolCall = toRecord(rawToolCall);
  if (!toolCall) {
    return;
  }

  const index = readNumber(toolCall, 'index');
  const functionRecord = toRecord(toolCall.function);
  const id = readString(toolCall, 'id');
  const name = functionRecord ? readString(functionRecord, 'name') : null;
  const argumentsDelta = functionRecord ? readString(functionRecord, 'arguments') : null;

  if (index === null) {
    return;
  }

  ensureMessageStarted(state, events);

  if (id && name && !state.activeToolCallIndexes.has(index)) {
    closeActiveBlock(state, events);
    state.activeToolCallIndexes.add(index);
    events.push({
      type: 'modelContentBlockStartEvent',
      start: {
        type: 'toolUseStart',
        name,
        toolUseId: id,
      },
    });
  }

  if (argumentsDelta && argumentsDelta.length > 0) {
    events.push({
      type: 'modelContentBlockDeltaEvent',
      delta: {
        type: 'toolUseInputDelta',
        input: argumentsDelta,
      },
    });
  }
};

const appendUsageEvent = (
  events: ModelStreamEvent[],
  rawUsage: unknown,
): void => {
  const usage = toRecord(rawUsage);
  if (!usage) {
    return;
  }

  events.push({
    type: 'modelMetadataEvent',
    usage: {
      inputTokens: readNumber(usage, 'prompt_tokens') ?? 0,
      outputTokens: readNumber(usage, 'completion_tokens') ?? 0,
      totalTokens: readNumber(usage, 'total_tokens') ?? 0,
    },
  });
};

const finalizeChunk = (
  state: IOpenAiChatStreamState,
  events: ModelStreamEvent[],
  finishReason: string | null,
): void => {
  if (!finishReason) {
    return;
  }

  ensureMessageStarted(state, events);
  closeActiveBlock(state, events);

  for (const index of state.activeToolCallIndexes) {
    events.push({
      type: 'modelContentBlockStopEvent',
    });
    state.activeToolCallIndexes.delete(index);
  }

  events.push({
    type: 'modelMessageStopEvent',
    stopReason: stopReasonFromFinishReason(finishReason),
  });
};

export const createOpenAiChatStreamState = (): IOpenAiChatStreamState => ({
  hasMessageStarted: false,
  activeBlock: null,
  activeToolCallIndexes: new Set<number>(),
});

export const mapOpenAiChatChunkToEvents = (
  chunk: unknown,
  state: IOpenAiChatStreamState,
): { events: ModelStreamEvent[]; hasReasoningContent: boolean } => {
  const events: ModelStreamEvent[] = [];
  const record = toRecord(chunk);
  if (!record) {
    return { events, hasReasoningContent: false };
  }

  appendUsageEvent(events, record.usage);

  const choice = toRecord(readArray(record, 'choices')[0]);
  if (!choice) {
    return { events, hasReasoningContent: false };
  }

  const delta = toRecord(choice.delta);
  if (!delta) {
    finalizeChunk(state, events, readString(choice, 'finish_reason'));
    return { events, hasReasoningContent: false };
  }

  if (readString(delta, 'role')) {
    ensureMessageStarted(state, events);
  }

  const reasoningContent = readString(delta, 'reasoning_content');
  const hasReasoningContent = appendReasoningDelta(state, events, reasoningContent);
  appendTextDelta(state, events, readString(delta, 'content'));

  for (const toolCall of readArray(delta, 'tool_calls')) {
    appendToolCallDelta(state, events, toolCall);
  }

  finalizeChunk(state, events, readString(choice, 'finish_reason'));

  return { events, hasReasoningContent };
};

export class OpenAiChatCompatModel extends Model<IOpenAiChatCompatModelConfig> {
  private _config: IOpenAiChatCompatModelConfig;
  private readonly _client: OpenAI;
  private _hasProviderReasoningContent: boolean;

  constructor(config: IOpenAiChatCompatModelConfig) {
    super();
    this._config = config;
    this._client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this._hasProviderReasoningContent = shouldSendReasoningForModel(config);
  }

  override updateConfig(modelConfig: IOpenAiChatCompatModelConfig): void {
    this._config = {
      ...this._config,
      ...modelConfig,
    };
    this._hasProviderReasoningContent = this._hasProviderReasoningContent ||
      shouldSendReasoningForModel(this._config);
  }

  override getConfig(): IOpenAiChatCompatModelConfig {
    return this._config;
  }

  override async *stream(
    messages: Message[],
    options?: StreamOptions,
  ): AsyncIterable<ModelStreamEvent> {
    if (messages.length === 0) {
      throw new Error('At least one message is required');
    }

    const systemPrompt = systemPromptToText(options?.systemPrompt);
    const formattedMessages = formatMessagesForOpenAiChat(
      messages,
      this._hasProviderReasoningContent,
    );
    const tools = createToolDefinitions(options?.toolSpecs);
    const toolChoice = createToolChoice(options?.toolChoice);
    const request: TChatRequest = {
      model: this._config.modelId,
      messages: systemPrompt
        ? [{ role: 'system', content: systemPrompt }, ...formattedMessages]
        : formattedMessages,
      stream: true,
      stream_options: {
        include_usage: true,
      },
      ...(tools ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      ...(this._config.maxTokens !== undefined
        ? { max_completion_tokens: this._config.maxTokens }
        : {}),
    };

    const stream = await this._client.chat.completions.create(request);
    const state = createOpenAiChatStreamState();

    for await (const chunk of stream) {
      const mapped = mapOpenAiChatChunkToEvents(chunk, state);
      if (mapped.hasReasoningContent) {
        this._hasProviderReasoningContent = true;
      }

      for (const event of mapped.events) {
        yield event;
      }
    }
  }
}

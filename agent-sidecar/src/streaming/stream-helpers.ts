// Mastra wire-name 常量 —— 由 stream-adapter.ts 和 stream-normalizer.ts 共享。
//
// LAST VERIFIED AGAINST: @mastra/core ~ check package.json
// 任何 Mastra minor 升级都应该重新 grep 这些字符串确认。

const MASTRA_EVENT = {
  beforeInvocation: "beforeInvocationEvent",
  beforeModelCall: "beforeModelCallEvent",
  afterModelCall: "afterModelCallEvent",
  modelStreamUpdate: "modelStreamUpdateEvent",
  modelContentBlockDelta: "modelContentBlockDeltaEvent",
  beforeToolCall: "beforeToolCallEvent",
  toolStreamUpdate: "toolStreamUpdateEvent",
  afterToolCall: "afterToolCallEvent",
  messageAdded: "messageAddedEvent",
  agentResult: "agentResultEvent",
} as const;

const MASTRA_DELTA_TYPE = {
  textDelta: "textDelta",
  reasoningContentDelta: "reasoningContentDelta",
  reasoningText: "reasoningText",
} as const;

export { MASTRA_EVENT, MASTRA_DELTA_TYPE };

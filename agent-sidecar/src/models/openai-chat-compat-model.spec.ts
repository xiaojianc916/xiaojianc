import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  Message,
  ReasoningBlock,
  TextBlock,
  ToolResultBlock,
  ToolUseBlock,
} from '@strands-agents/sdk';

import {
  createOpenAiChatStreamState,
  formatMessagesForOpenAiChat,
  mapOpenAiChatChunkToEvents,
} from './openai-chat-compat-model.js';

describe('OpenAI chat compatible model formatter', () => {
  it('keeps tool messages non-empty when a tool returns an empty file', () => {
    const messages = [
      new Message({
        role: 'user',
        content: [
          new ToolResultBlock({
            toolUseId: 'call_empty_file',
            status: 'success',
            content: [new TextBlock('')],
          }),
        ],
      }),
    ];

    const formatted = formatMessagesForOpenAiChat(messages, false);

    assert.deepEqual(formatted, [
      {
        role: 'tool',
        tool_call_id: 'call_empty_file',
        content: 'Tool completed successfully with no output.',
      },
    ]);
  });

  it('passes DeepSeek thinking content back with assistant tool calls', () => {
    const messages = [
      new Message({
        role: 'assistant',
        content: [
          new ReasoningBlock({
            text: 'Need to read the current file before editing.',
          }),
          new TextBlock('I will inspect the file first.'),
          new ToolUseBlock({
            name: 'read_file',
            toolUseId: 'call_read_file',
            input: {
              path: 'D:/com.xiaojianc/my_desktop_app/test.sh',
            },
          }),
        ],
      }),
    ];

    const formatted = formatMessagesForOpenAiChat(messages, true);

    assert.deepEqual(formatted, [
      {
        role: 'assistant',
        content: 'I will inspect the file first.',
        reasoning_content: 'Need to read the current file before editing.',
        tool_calls: [
          {
            id: 'call_read_file',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: '{"path":"D:/com.xiaojianc/my_desktop_app/test.sh"}',
            },
          },
        ],
      },
    ]);
  });

  it('does not send provider-specific reasoning content to non-thinking models', () => {
    const messages = [
      new Message({
        role: 'assistant',
        content: [
          new ReasoningBlock({
            text: 'Internal thinking from a previous provider response.',
          }),
          new TextBlock('Visible answer.'),
        ],
      }),
    ];

    const formatted = formatMessagesForOpenAiChat(messages, false);

    assert.deepEqual(formatted, [
      {
        role: 'assistant',
        content: 'Visible answer.',
      },
    ]);
  });

  it('maps streamed visible text chunks to text delta events', () => {
    const state = createOpenAiChatStreamState();

    const first = mapOpenAiChatChunkToEvents({
      choices: [
        {
          delta: {
            role: 'assistant',
            content: '第一段',
          },
        },
      ],
    }, state);
    const second = mapOpenAiChatChunkToEvents({
      choices: [
        {
          delta: {
            content: '继续输出',
          },
        },
      ],
    }, state);
    const stop = mapOpenAiChatChunkToEvents({
      choices: [
        {
          delta: {},
          finish_reason: 'stop',
        },
      ],
    }, state);

    assert.deepEqual(first.events, [
      {
        type: 'modelMessageStartEvent',
        role: 'assistant',
      },
      {
        type: 'modelContentBlockStartEvent',
      },
      {
        type: 'modelContentBlockDeltaEvent',
        delta: {
          type: 'textDelta',
          text: '第一段',
        },
      },
    ]);
    assert.deepEqual(second.events, [
      {
        type: 'modelContentBlockDeltaEvent',
        delta: {
          type: 'textDelta',
          text: '继续输出',
        },
      },
    ]);
    assert.deepEqual(stop.events, [
      {
        type: 'modelContentBlockStopEvent',
      },
      {
        type: 'modelMessageStopEvent',
        stopReason: 'endTurn',
      },
    ]);
  });

  it('captures streamed DeepSeek reasoning content before tool calls', () => {
    const state = createOpenAiChatStreamState();

    const reasoning = mapOpenAiChatChunkToEvents({
      choices: [
        {
          delta: {
            role: 'assistant',
            reasoning_content: 'Need to inspect the file.',
          },
        },
      ],
    }, state);
    const toolUse = mapOpenAiChatChunkToEvents({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_read_file',
                function: {
                  name: 'read_file',
                  arguments: '{"path":"test.sh"}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    }, state);

    assert.equal(reasoning.hasReasoningContent, true);
    assert.deepEqual(reasoning.events, [
      {
        type: 'modelMessageStartEvent',
        role: 'assistant',
      },
      {
        type: 'modelContentBlockStartEvent',
      },
      {
        type: 'modelContentBlockDeltaEvent',
        delta: {
          type: 'reasoningContentDelta',
          text: 'Need to inspect the file.',
        },
      },
    ]);
    assert.deepEqual(toolUse.events, [
      {
        type: 'modelContentBlockStopEvent',
      },
      {
        type: 'modelContentBlockStartEvent',
        start: {
          type: 'toolUseStart',
          name: 'read_file',
          toolUseId: 'call_read_file',
        },
      },
      {
        type: 'modelContentBlockDeltaEvent',
        delta: {
          type: 'toolUseInputDelta',
          input: '{"path":"test.sh"}',
        },
      },
      {
        type: 'modelContentBlockStopEvent',
      },
      {
        type: 'modelMessageStopEvent',
        stopReason: 'toolUse',
      },
    ]);
  });
});

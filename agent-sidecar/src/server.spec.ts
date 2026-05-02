import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AgentResult, Message, ReasoningBlock, TextBlock } from '@strands-agents/sdk';

import {
  agentSidecarChatRequestSchema,
  agentSidecarExecuteRequestSchema,
  agentSidecarPlanRequestSchema,
} from './server.js';
import { buildSystemPrompt, extractVisibleAgentResultText } from './engines/strands-engine.js';

describe('Agent sidecar request schema', () => {
  it('normalizes nullable optional fields from old Tauri clients', () => {
    const payload = agentSidecarChatRequestSchema.parse({
      sessionId: null,
      mode: null,
      goal: null,
      messages: [],
      workspaceRootPath: null,
      context: [],
    });

    assert.equal(payload.sessionId, undefined);
    assert.equal(payload.mode, undefined);
    assert.equal(payload.goal, undefined);
    assert.equal(payload.workspaceRootPath, null);
  });

  it('accepts omitted optional fields from current Tauri clients', () => {
    const payload = agentSidecarExecuteRequestSchema.parse({
      goal: 'run',
      messages: [{ role: 'user', content: 'run' }],
      context: [],
    });

    assert.equal(payload.sessionId, undefined);
    assert.equal(payload.mode, undefined);
    assert.equal(payload.workspaceRootPath, undefined);
    assert.equal(payload.goal, 'run');
  });

  it('normalizes blank optional fields without accepting invalid modes', () => {
    const payload = agentSidecarChatRequestSchema.parse({
      sessionId: '',
      mode: ' ',
      goal: ' ',
      messages: [],
      workspaceRootPath: '',
      context: [],
    });

    assert.equal(payload.sessionId, undefined);
    assert.equal(payload.mode, undefined);
    assert.equal(payload.goal, undefined);
    assert.equal(payload.workspaceRootPath, undefined);
    assert.throws(() => agentSidecarChatRequestSchema.parse({
      mode: 'invalid',
      messages: [],
      context: [],
    }));
  });

  it('requires a non-empty goal for plan and execute requests', () => {
    assert.throws(() =>
      agentSidecarPlanRequestSchema.parse({
        goal: ' ',
        messages: [],
        context: [],
      }),
    );
    assert.throws(() =>
      agentSidecarExecuteRequestSchema.parse({
        goal: null,
        messages: [],
        context: [],
      }),
    );
  });

  it('keeps valid execute payloads aligned with engine input fields', () => {
    const payload = agentSidecarExecuteRequestSchema.parse({
      sessionId: null,
      mode: 'agent',
      goal: ' run ',
      messages: [{ role: 'user', content: 'run' }],
      workspaceRootPath: 'D:/com.xiaojianc/my_desktop_app',
      context: [],
    });

    assert.equal(payload.sessionId, undefined);
    assert.equal(payload.mode, 'agent');
    assert.equal(payload.goal, 'run');
    assert.equal(payload.messages.length, 1);
    assert.equal(payload.workspaceRootPath, 'D:/com.xiaojianc/my_desktop_app');
  });
});

describe('Agent sidecar system prompt', () => {
  it('keeps identity prompt model-aware and concise', () => {
    const prompt = buildSystemPrompt({
      mode: 'agent',
      goal: '回答你是谁',
      messages: [{ role: 'user', content: '你是谁' }],
      context: [],
    }, 'deepseek-v4-pro');

    assert.match(prompt, /当前模型：deepseek-v4-pro/);
    assert.match(prompt, /DeepSeek/);
    assert.doesNotMatch(prompt, /不要自称|由 .* 公司开发/);
  });

  it('allows Claude identity when the current model is Claude', () => {
    const prompt = buildSystemPrompt({
      mode: 'agent',
      goal: '回答你是谁',
      messages: [{ role: 'user', content: '你是谁' }],
      context: [],
    }, 'anthropic/claude-sonnet-4-6');

    assert.match(prompt, /当前模型：anthropic\/claude-sonnet-4-6/);
    assert.match(prompt, /Anthropic/);
    assert.doesNotMatch(prompt, /当前模型不是|不要自称/);
  });
});

describe('Agent sidecar visible result', () => {
  it('does not expose reasoning blocks in the final assistant text', () => {
    const result = new AgentResult({
      stopReason: 'endTurn',
      lastMessage: new Message({
        role: 'assistant',
        content: [
          new ReasoningBlock({
            text: '内部推理，不应该进入用户可见回答。',
          }),
          new TextBlock('这是用户应该看到的回答。'),
        ],
      }),
      invocationState: {},
    });

    const visibleText = extractVisibleAgentResultText(result);

    assert.equal(visibleText, '这是用户应该看到的回答。');
    assert.doesNotMatch(visibleText, /Reasoning|内部推理/u);
  });

  it('preserves fenced code formatting when visible text is split across multiple text blocks', () => {
    const result = new AgentResult({
      stopReason: 'endTurn',
      lastMessage: new Message({
        role: 'assistant',
        content: [
          new TextBlock('不过我可以帮你把它的内容清空（已经是空的），或者建议你手动执行：\n\n```bash\n'),
          new TextBlock('Remove-Item .\\666.sh\n```\n'),
        ],
      }),
      invocationState: {},
    });

    const visibleText = extractVisibleAgentResultText(result);

    assert.equal(
      visibleText,
      '不过我可以帮你把它的内容清空（已经是空的），或者建议你手动执行：\n\n```bash\nRemove-Item .\\666.sh\n```',
    );
  });
});

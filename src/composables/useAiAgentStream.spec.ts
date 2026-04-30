import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAiAgentStream } from '@/composables/useAiAgentStream';
import { useAiAgentStore } from '@/store/aiAgent';

import type { TAiAgentStreamEvent } from '@/types/ai';

const aiServiceMock = vi.hoisted(() => {
  const onAgentStream = vi.fn(async (handler: (event: TAiAgentStreamEvent) => void) => {
    void handler;
    return vi.fn();
  });

  return {
    onAgentStream,
    reset(): void {
      onAgentStream.mockClear();
    },
  };
});

vi.mock('@/services/modules/ai', () => ({
  aiService: {
    onAgentStream: aiServiceMock.onAgentStream,
  },
}));

const createPatchSummaryEvent = (): TAiAgentStreamEvent => ({
  event: 'patch.summary',
  seq: 1,
  runId: 'run-1',
  summary: {
    id: 'patch-summary-1',
    runId: 'run-1',
    stepId: 'step-1',
    files: [{
      path: 'src/App.vue',
      status: 'modified',
      additions: 2,
      deletions: 1,
      diffRef: 'aed-diff:thread-1:src%2FApp.vue',
    }],
    totalAdditions: 2,
    totalDeletions: 1,
    patchRef: 'aed-patch:thread-1',
    appliedAt: '2026-04-29T10:00:00.000Z',
  },
});

describe('useAiAgentStream', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    aiServiceMock.reset();
  });

  it('subscribes to Agent stream only once', async () => {
    const agentStream = useAiAgentStream();

    await agentStream.start();
    await agentStream.start();

    expect(aiServiceMock.onAgentStream).toHaveBeenCalledTimes(1);
    expect(agentStream.isListening.value).toBe(true);
  });

  it('aggregates patch.summary events into Agent store', () => {
    const agentStream = useAiAgentStream();
    const store = useAiAgentStore();

    agentStream.handleEvent(createPatchSummaryEvent());

    expect(store.getPatchSummaries('run-1')).toHaveLength(1);
    expect(store.getPatchSummaries('run-1')[0]?.files[0]?.diffRef).toBe(
      'aed-diff:thread-1:src%2FApp.vue',
    );
  });

  it('updates run and stream error metadata', () => {
    const agentStream = useAiAgentStream();
    const store = useAiAgentStore();

    agentStream.handleEvent({
      event: 'agent.run',
      seq: 1,
      runId: 'run-1',
      run: {
        id: 'run-1',
        goal: '实现 Agent stream',
        status: 'running-plan',
        currentStepId: null,
        createdAt: '2026-04-29T10:00:00.000Z',
        updatedAt: '2026-04-29T10:00:00.000Z',
        startedAt: '2026-04-29T10:00:00.000Z',
        completedAt: null,
        errorMessage: null,
        steps: [
          {
            id: 'step-1',
            index: 0,
            title: '检查事件链路',
            goal: '检查事件链路',
            kind: 'inspect',
            status: 'pending',
            expectedOutput: '事件链路说明',
            tools: ['search_text'],
            requiresUserApproval: false,
            riskLevel: 'low',
          },
          {
            id: 'step-2',
            index: 1,
            title: '接入 store',
            goal: '接入 store',
            kind: 'edit',
            status: 'pending',
            expectedOutput: 'store 可聚合事件',
            tools: ['propose_patch'],
            requiresUserApproval: true,
            riskLevel: 'medium',
          },
        ],
      },
    });

    expect(store.activeRun?.id).toBe('run-1');

    agentStream.handleEvent({
      event: 'stream.error',
      seq: 2,
      runId: 'run-1',
      error: {
        code: 'AI_AGENT_STEP_FAILED',
        message: 'Agent step 执行失败',
        scope: 'ipc',
        traceId: 'trace-1',
        timestamp: '2026-04-29T10:00:01.000Z',
      },
    });

    expect(store.errorMessage).toBe('Agent step 执行失败');
  });

  it('aggregates step and tool activity events', () => {
    const agentStream = useAiAgentStream();
    const store = useAiAgentStore();

    store.upsertRun({
      id: 'run-1',
      goal: '接入工具活动',
      status: 'running-plan',
      currentStepId: null,
      createdAt: '2026-04-29T10:00:00.000Z',
      updatedAt: '2026-04-29T10:00:00.000Z',
      startedAt: '2026-04-29T10:00:00.000Z',
      completedAt: null,
      errorMessage: null,
      steps: [{
        id: 'step-1',
        index: 0,
        title: '检查工具链路',
        goal: '检查工具链路',
        kind: 'inspect',
        status: 'pending',
        expectedOutput: '事件已进入 store',
        tools: ['search_text'],
        requiresUserApproval: false,
        riskLevel: 'low',
      }],
    });

    agentStream.handleEvent({
      event: 'agent.step',
      seq: 2,
      runId: 'run-1',
      step: {
        id: 'step-1',
        index: 0,
        title: '检查工具链路',
        goal: '检查工具链路',
        kind: 'inspect',
        status: 'running',
        expectedOutput: '事件已进入 store',
        tools: ['search_text'],
        requiresUserApproval: false,
        riskLevel: 'low',
        isActive: true,
      },
    });
    agentStream.handleEvent({
      event: 'tool.activity',
      seq: 3,
      runId: 'run-1',
      activity: {
        id: 'activity-1',
        stepId: 'step-1',
        toolName: 'search_text',
        state: 'running',
        label: '正在校验工具 search_text…',
        startedAt: '2026-04-29T10:00:01.000Z',
      },
    });
    agentStream.handleEvent({
      event: 'tool.activity',
      seq: 4,
      runId: 'run-1',
      activity: {
        id: 'activity-2',
        stepId: 'step-1',
        toolName: 'search_text',
        state: 'succeeded',
        label: '已校验工具 search_text',
        startedAt: '2026-04-29T10:00:01.000Z',
      },
    });

    expect(store.activeRun?.currentStepId).toBe('step-1');
    expect(store.activeToolActivity).toBeNull();
    expect(store.getStepDetail('run-1', 'step-1')?.toolResults[0]?.summary).toBe(
      '已校验工具 search_text',
    );
  });
});

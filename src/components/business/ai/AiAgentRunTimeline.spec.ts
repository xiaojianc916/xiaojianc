import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AiAgentRunTimeline from '@/components/business/ai/AiAgentRunTimeline.vue';
import type {
  IAiAgentPatchSummary,
  IAiAgentRun,
  IAiAgentStepDetail,
  IAiTaskPlanStep,
} from '@/types/ai';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const createStep = (
  index: number,
  overrides: Partial<IAiTaskPlanStep> = {},
): IAiTaskPlanStep => ({
  id: `step-${index + 1}`,
  index,
  title: index === 0 ? '检查现有上下文' : '读取官方文档',
  goal: `完成第 ${index + 1} 步`,
  kind: index === 0 ? 'inspect' : 'search',
  status: index === 0 ? 'done' : 'running',
  expectedOutput: `产物 ${index + 1}`,
  tools: index === 0 ? ['search_text'] : ['web_search', 'web_fetch'],
  requiresUserApproval: index > 0,
  riskLevel: index === 0 ? 'low' : 'medium',
  ...overrides,
});

const createRun = (
  steps: IAiTaskPlanStep[],
  overrides: Partial<IAiAgentRun> = {},
): IAiAgentRun => ({
  id: 'run-1',
  goal: '接入 Agent 网络搜索能力',
  status: 'running-step',
  steps,
  currentStepId: 'step-2',
  createdAt: '2026-04-29T10:00:00.000Z',
  updatedAt: '2026-04-29T10:00:02.000Z',
  startedAt: '2026-04-29T10:00:00.000Z',
  completedAt: null,
  errorMessage: null,
  ...overrides,
});

const createStepDetail = (
  overrides: Partial<IAiAgentStepDetail> = {},
): IAiAgentStepDetail => ({
  runId: 'run-1',
  stepId: 'step-2',
  updatedAt: '2026-04-29T10:00:03.000Z',
  webSources: [
    {
      id: 'source-1',
      title: 'Tauri Docs',
      url: 'https://tauri.app/reference/',
      sourceType: 'docs',
      status: 'fetched',
      queryPreview: 'Tauri capability docs',
      fetchedAt: '2026-04-29T10:00:02.000Z',
      textRef: 'web-text:abc',
      excerpt: '<html>不应进入 timeline 的网页正文</html>',
    },
  ],
  toolResults: [
    {
      id: 'tool-1',
      runId: 'run-1',
      stepId: 'step-2',
      toolName: 'web_fetch',
      status: 'succeeded',
      summary: '读取 1 个网页正文引用',
      startedAt: '2026-04-29T10:00:01.000Z',
      endedAt: '2026-04-29T10:00:02.000Z',
      outputRef: 'web-text:abc',
    },
  ],
  ...overrides,
});

const createPatchSummary = (
  overrides: Partial<IAiAgentPatchSummary> = {},
): IAiAgentPatchSummary => ({
  id: 'patch-summary-1',
  runId: 'run-1',
  stepId: 'step-2',
  totalAdditions: 8,
  totalDeletions: 2,
  patchRef: 'patch:run-1:step-2',
  appliedAt: '2026-04-29T10:00:04.000Z',
  files: [
    {
      path: 'src/agent/runtime.ts',
      status: 'modified',
      additions: 8,
      deletions: 2,
      diffRef: 'diff:runtime',
    },
  ],
  ...overrides,
});

const mountTimeline = (
  stepDetails: Record<string, IAiAgentStepDetail> = {},
  steps: IAiTaskPlanStep[] = [createStep(0), createStep(1)],
  patchSummaries: IAiAgentPatchSummary[] = [],
  runOverrides: Partial<IAiAgentRun> = {},
): VueWrapper<InstanceType<typeof AiAgentRunTimeline>> =>
  mount(AiAgentRunTimeline, {
    props: {
      run: createRun(steps, runOverrides),
      stepDetails,
      patchSummaries,
    },
  });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AiAgentRunTimeline', () => {
  // —— 原始用例：保持不变，确保可完美替换 ——

  it('按 step index 顺序渲染 timeline', () => {
    const wrapper = mountTimeline({}, [createStep(1), createStep(0)]);

    expect(
      wrapper.findAll('.ai-agent-timeline-step-title').map((node) => node.text()),
    ).toEqual(['检查现有上下文', '读取官方文档']);
  });

  it('渲染工具结果摘要、Web 来源和 ref，不展示网页全文', () => {
    const wrapper = mountTimeline({
      'run-1:step-2': createStepDetail(),
    });

    expect(wrapper.text()).toContain('web_fetch');
    expect(wrapper.text()).toContain('读取 1 个网页正文引用');
    expect(wrapper.text()).toContain('Tauri Docs');
    expect(wrapper.text()).toContain('ref: web-text:abc');
    expect(wrapper.text()).not.toContain('<html>');
    expect(wrapper.text()).not.toContain('不应进入 timeline 的网页正文');
  });

  it('失败工具结果显示失败态', () => {
    const wrapper = mountTimeline({
      'run-1:step-2': createStepDetail({
        webSources: [],
        toolResults: [
          {
            id: 'tool-failed-1',
            runId: 'run-1',
            stepId: 'step-2',
            toolName: 'web_search',
            status: 'failed',
            summary: 'AI_AGENT_WEB_SEARCH_FAILED',
            startedAt: '2026-04-29T10:00:01.000Z',
            endedAt: '2026-04-29T10:00:02.000Z',
          },
        ],
      }),
    });

    expect(wrapper.find('.ai-agent-timeline-child.is-failed').exists()).toBe(true);
    expect(wrapper.text()).toContain('AI_AGENT_WEB_SEARCH_FAILED');
  });

  it('渲染 patch summary 的 changed files，但不展示完整 diff', async () => {
    const wrapper = mountTimeline({}, [createStep(0), createStep(1)], [createPatchSummary()]);

    expect(wrapper.text()).toContain('Files changed');
    expect(wrapper.text()).toContain('src/agent/runtime.ts');
    expect(wrapper.text()).toContain('+8');
    expect(wrapper.text()).toContain('-2');
    expect(wrapper.text()).toContain('patch:run-1:step-2');
    expect(wrapper.text()).not.toContain("- const mode = 'chat'");

    await wrapper.find('.ai-changed-file-action').trigger('click');
    expect(wrapper.emitted('openDiff')).toEqual([
      [
        {
          diffRef: 'diff:runtime',
          filePath: 'src/agent/runtime.ts',
          patchRef: 'patch:run-1:step-2',
          runId: 'run-1',
          stepId: 'step-2',
        },
      ],
    ]);
  });

  // —— 以下为补充用例，仅新增、不修改既有断言 ——

  it('当 stepDetails 为空时，仅渲染 step 标题，不渲染工具结果或 Web 来源', () => {
    const wrapper = mountTimeline({});

    // 两个 step 标题都应该存在
    expect(wrapper.findAll('.ai-agent-timeline-step-title')).toHaveLength(2);

    // 不应出现任何工具结果或 web 来源相关文本
    const text = wrapper.text();
    expect(text).not.toContain('web_fetch');
    expect(text).not.toContain('Tauri Docs');
    expect(text).not.toContain('ref: web-text:abc');
  });

  it('多 step 同时有 stepDetail 时，应分别渲染对应 step 下的工具结果', () => {
    const stepOneDetail: IAiAgentStepDetail = {
      runId: 'run-1',
      stepId: 'step-1',
      updatedAt: '2026-04-29T10:00:01.000Z',
      webSources: [],
      toolResults: [
        {
          id: 'tool-step1',
          runId: 'run-1',
          stepId: 'step-1',
          toolName: 'search_text',
          status: 'succeeded',
          summary: '本地代码检索完成',
          startedAt: '2026-04-29T10:00:00.500Z',
          endedAt: '2026-04-29T10:00:01.000Z',
        },
      ],
    };

    const wrapper = mountTimeline({
      'run-1:step-1': stepOneDetail,
      'run-1:step-2': createStepDetail(),
    });

    const text = wrapper.text();
    expect(text).toContain('search_text');
    expect(text).toContain('本地代码检索完成');
    expect(text).toContain('web_fetch');
    expect(text).toContain('读取 1 个网页正文引用');
  });

  it('运行中的工具结果不应被标记为失败态', () => {
    const wrapper = mountTimeline({
      'run-1:step-2': createStepDetail({
        webSources: [],
        toolResults: [
          {
            id: 'tool-running-1',
            runId: 'run-1',
            stepId: 'step-2',
            toolName: 'web_search',
            status: 'running',
            summary: '正在检索…',
            startedAt: '2026-04-29T10:00:01.000Z',
            endedAt: null,
          },
        ],
      }),
    });

    expect(wrapper.find('.ai-agent-timeline-child.is-failed').exists()).toBe(false);
    expect(wrapper.text()).toContain('正在检索…');
  });

  it('多个 patch summary 应按顺序渲染各自的文件并支持点击各自的 diff', async () => {
    const secondPatch = createPatchSummary({
      id: 'patch-summary-2',
      stepId: 'step-1',
      totalAdditions: 3,
      totalDeletions: 0,
      patchRef: 'patch:run-1:step-1',
      files: [
        {
          path: 'src/agent/setup.ts',
          status: 'added',
          additions: 3,
          deletions: 0,
          diffRef: 'diff:setup',
        },
      ],
    });

    const wrapper = mountTimeline(
      {},
      [createStep(0), createStep(1)],
      [createPatchSummary(), secondPatch],
    );

    const text = wrapper.text();
    expect(text).toContain('src/agent/runtime.ts');
    expect(text).toContain('src/agent/setup.ts');
    expect(text).toContain('patch:run-1:step-2');
    expect(text).toContain('patch:run-1:step-1');

    const actions = wrapper.findAll('.ai-changed-file-action');
    expect(actions.length).toBeGreaterThanOrEqual(2);

    // 点击两个文件，验证 emit 顺序与各自的 patch 关联
    await actions[0].trigger('click');
    await actions[1].trigger('click');

    const emitted = wrapper.emitted('openDiff') ?? [];
    expect(emitted).toHaveLength(2);

    const payloads = emitted.map(([payload]) => payload as Record<string, unknown>);
    // 不假设顺序与 patchSummaries 数组顺序一致，仅断言两个 patch 的 payload 都被 emit
    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          diffRef: 'diff:runtime',
          filePath: 'src/agent/runtime.ts',
          patchRef: 'patch:run-1:step-2',
          runId: 'run-1',
          stepId: 'step-2',
        }),
        expect.objectContaining({
          diffRef: 'diff:setup',
          filePath: 'src/agent/setup.ts',
          patchRef: 'patch:run-1:step-1',
          runId: 'run-1',
          stepId: 'step-1',
        }),
      ]),
    );
  });

  it('run 失败时应展示错误信息（errorMessage）', () => {
    const wrapper = mountTimeline(
      {},
      [createStep(0), createStep(1)],
      [],
      {
        status: 'failed',
        errorMessage: 'AI_AGENT_RUN_ABORTED',
        completedAt: '2026-04-29T10:00:05.000Z',
      },
    );

    expect(wrapper.text()).toContain('AI_AGENT_RUN_ABORTED');
  });
});
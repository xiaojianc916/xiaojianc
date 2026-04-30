import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AiPlanModePanel from '@/components/business/ai/AiPlanModePanel.vue';
import type { IAiAgentRun, IAiTaskPlanStep } from '@/types/ai';

const createStep = (index: number): IAiTaskPlanStep => ({
  id: `plan-step-${index + 1}`,
  index,
  title: index === 0 ? '收集上下文' : '输出方案',
  goal: index === 0 ? '收集上下文' : '输出方案',
  kind: index === 0 ? 'inspect' : 'summarize',
  status: 'pending',
  expectedOutput: index === 0 ? '影响范围' : '实施计划',
  tools: index === 0 ? ['search_text'] : ['get_diagnostics'],
  requiresUserApproval: false,
  riskLevel: 'low',
});

const createRun = (
  steps: IAiTaskPlanStep[],
  overrides: Partial<IAiAgentRun> = {},
): IAiAgentRun => ({
  id: 'agent-run-1',
  goal: '接入 Agent Plan Mode',
  status: 'running-plan',
  steps,
  currentStepId: null,
  createdAt: '2026-04-29T10:00:00.000Z',
  updatedAt: '2026-04-29T10:00:00.000Z',
  startedAt: '2026-04-29T10:00:00.000Z',
  completedAt: null,
  errorMessage: null,
  ...overrides,
});

const mountPanel = (overrides: Partial<InstanceType<typeof AiPlanModePanel>['$props']> = {}) =>
  mount(AiPlanModePanel, {
    props: {
      goal: '接入 Agent Plan Mode',
      steps: [createStep(0), createStep(1), createStep(2)],
      classificationReason: '任务包含多阶段动作或潜在写盘影响，需先计划后执行。',
      errorMessage: '',
      isPlanning: false,
      isApproving: false,
      approvedAt: null,
      activeRun: null,
      isRunActionPending: false,
      ...overrides,
    },
  });

const findButtonByText = (
  wrapper: ReturnType<typeof mountPanel>,
  label: string,
) => {
  const button = wrapper.findAll('button').find((item) => item.text() === label);

  if (!button) {
    throw new Error(`找不到按钮：${label}`);
  }

  return button;
};

describe('AiPlanModePanel', () => {
  it('展示计划步骤并支持批准计划', async () => {
    const wrapper = mountPanel();

    expect(wrapper.text()).toContain('接入 Agent Plan Mode');
    const titleInputs = wrapper.findAll<HTMLInputElement>('input[aria-label="编辑计划步骤标题"]');
    expect(titleInputs[0]?.element.value).toBe('收集上下文');
    expect(titleInputs[1]?.element.value).toBe('输出方案');

    await wrapper.find('.ai-plan-button.is-primary').trigger('click');

    expect(wrapper.emitted('approve')).toHaveLength(1);
  });

  it('计划已批准后禁用批准按钮并展示待执行说明', async () => {
    const steps = [createStep(0), createStep(1), createStep(2)];
    const wrapper = mountPanel({
      steps,
      approvedAt: '2026-04-29T10:00:00.000Z',
      activeRun: createRun(steps),
    });

    const approveButton = findButtonByText(wrapper, '已批准');

    expect(wrapper.text()).toContain('运行中');
    expect(approveButton.attributes('disabled')).toBeDefined();
  });

  it('编辑标题和删除步骤时向外抛出事件', async () => {
    const wrapper = mountPanel();
    const input = wrapper.find('input[aria-label="编辑计划步骤标题"]');

    await input.setValue('重新收集上下文');
    await input.trigger('keydown.enter');

    expect(wrapper.emitted('updateStepTitle')).toEqual([
      ['plan-step-1', '重新收集上下文'],
    ]);

    await wrapper.find('.ai-plan-step-remove').trigger('click');

    expect(wrapper.emitted('removeStep')).toEqual([
      ['plan-step-1'],
    ]);
  });

  it('展示运行状态并支持推进、暂停、取消 run', async () => {
    const steps = [createStep(0), createStep(1), createStep(2)];
    const wrapper = mountPanel({
      steps,
      approvedAt: '2026-04-29T10:00:00.000Z',
      activeRun: createRun(steps),
    });

    expect(wrapper.text()).toContain('运行中');
    expect(wrapper.text()).toContain('0/3 步');

    await findButtonByText(wrapper, '执行下一步').trigger('click');
    await findButtonByText(wrapper, '暂停').trigger('click');
    await findButtonByText(wrapper, '取消').trigger('click');

    expect(wrapper.emitted('runStep')).toHaveLength(1);
    expect(wrapper.emitted('pauseRun')).toHaveLength(1);
    expect(wrapper.emitted('cancelRun')).toHaveLength(1);
  });

  it('在计划下方展示当前 Web 工具活动', () => {
    const wrapper = mountPanel({
      webActivity: {
        id: 'web-activity-1',
        state: 'searching',
        label: '正在搜索…',
        queryPreview: 'Tauri docs',
        stepId: 'plan-step-1',
      },
    });

    expect(wrapper.text()).toContain('Tauri docs');
    expect(wrapper.find('.ai-web-activity-dots').exists()).toBe(true);
  });

  it('展示当前 step detail 的工具结果与来源摘要', () => {
    const wrapper = mountPanel({
      activeStepDetail: {
        runId: 'agent-run-1',
        stepId: 'plan-step-1',
        updatedAt: '2026-04-29T10:00:00.000Z',
        webSources: [{
          id: 'web-source-1',
          title: 'Tauri Docs',
          url: 'https://tauri.app/start/',
          sourceType: 'docs',
          status: 'fetched',
          queryPreview: 'Tauri docs',
          fetchedAt: '2026-04-29T10:00:00.000Z',
          textRef: 'web-text:abc',
          excerpt: 'Tauri docs excerpt',
        }],
        toolResults: [{
          id: 'tool-result-1',
          runId: 'agent-run-1',
          stepId: 'plan-step-1',
          toolName: 'web_search',
          status: 'succeeded',
          summary: '搜索到 1 个来源',
          startedAt: '2026-04-29T10:00:00.000Z',
          endedAt: '2026-04-29T10:00:01.000Z',
        }],
      },
    });

    expect(wrapper.text()).toContain('Step Detail');
    expect(wrapper.text()).toContain('Tauri Docs');
    expect(wrapper.text()).toContain('搜索到 1 个来源');
  });});

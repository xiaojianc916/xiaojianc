import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AiChangedFilesSummary from '@/components/business/ai/AiChangedFilesSummary.vue';
import type { IAiAgentPatchSummary } from '@/types/ai';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * 构造一个带有单文件 modified 的 patch summary。
 * 保持与原测试一致的字段与取值，作为「黄金路径」基线。
 */
const createPatchSummary = (
  overrides: Partial<IAiAgentPatchSummary> = {},
): IAiAgentPatchSummary => ({
  id: 'patch-summary-1',
  runId: 'run-1',
  stepId: 'step-1',
  totalAdditions: 12,
  totalDeletions: 4,
  patchRef: 'patch:run-1:step-1',
  appliedAt: '2026-04-29T10:00:00.000Z',
  files: [
    {
      path: 'src/agent/runtime.ts',
      status: 'modified',
      additions: 12,
      deletions: 4,
      diffRef: 'diff:runtime',
      rollbackRef: 'rollback:runtime',
    },
  ],
  ...overrides,
});

/**
 * 构造一个多文件、多状态的 patch summary，用于覆盖列表渲染与按文件 emit。
 */
const createMultiFilePatchSummary = (): IAiAgentPatchSummary =>
  createPatchSummary({
    id: 'patch-summary-2',
    totalAdditions: 20,
    totalDeletions: 7,
    patchRef: 'patch:run-1:step-2',
    files: [
      {
        path: 'src/agent/runtime.ts',
        status: 'modified',
        additions: 12,
        deletions: 4,
        diffRef: 'diff:runtime',
        rollbackRef: 'rollback:runtime',
      },
      {
        path: 'src/agent/new-file.ts',
        status: 'added',
        additions: 8,
        deletions: 0,
        diffRef: 'diff:new-file',
        rollbackRef: 'rollback:new-file',
      },
      {
        path: 'src/agent/old-file.ts',
        status: 'deleted',
        additions: 0,
        deletions: 3,
        diffRef: 'diff:old-file',
        rollbackRef: 'rollback:old-file',
      },
    ],
  });

const mountSummary = (
  summary: IAiAgentPatchSummary,
): VueWrapper<InstanceType<typeof AiChangedFilesSummary>> =>
  mount(AiChangedFilesSummary, {
    props: { summary },
  });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AiChangedFilesSummary', () => {
  // —— 原始用例：保持不变，确保可完美替换 ——
  it('展示 changed files 统计并通过 ref 触发查看 diff', async () => {
    const wrapper = mount(AiChangedFilesSummary, {
      props: {
        summary: createPatchSummary(),
      },
    });

    expect(wrapper.text()).toContain('Files changed');
    expect(wrapper.text()).toContain('src/agent/runtime.ts');
    expect(wrapper.text()).toContain('+12');
    expect(wrapper.text()).toContain('-4');
    expect(wrapper.text()).toContain('patch:run-1:step-1');

    await wrapper.find('.ai-changed-file-action').trigger('click');
    expect(wrapper.emitted('viewDiff')).toEqual([
      ['diff:runtime', 'src/agent/runtime.ts'],
    ]);
  });

  // —— 以下为补充用例，仅新增、不修改既有断言 ——

  it('当 files 为空时，仍应展示 Files changed 标题且不渲染任何文件行', () => {
    const wrapper = mountSummary(
      createPatchSummary({
        totalAdditions: 0,
        totalDeletions: 0,
        files: [],
      }),
    );

    expect(wrapper.text()).toContain('Files changed');
    expect(wrapper.findAll('.ai-changed-file-action')).toHaveLength(0);
    expect(wrapper.emitted('viewDiff')).toBeUndefined();
  });

  it('多文件场景下，应按顺序渲染每个文件并在点击时按文件 emit viewDiff', async () => {
    const summary = createMultiFilePatchSummary();
    const wrapper = mountSummary(summary);

    // 标题与每个文件路径都应被渲染
    expect(wrapper.text()).toContain('Files changed');
    for (const file of summary.files) {
      expect(wrapper.text()).toContain(file.path);
    }

    // 渲染顺序应与 props.files 一致
    const actions = wrapper.findAll('.ai-changed-file-action');
    expect(actions).toHaveLength(summary.files.length);

    // 依次点击每个文件，验证 emit 顺序与负载
    for (let i = 0; i < actions.length; i++) {
      await actions[i].trigger('click');
    }

    expect(wrapper.emitted('viewDiff')).toEqual(
      summary.files.map((file) => [file.diffRef, file.path]),
    );
  });

  it('应展示文件级的新增/删除行数（含 added 与 deleted 状态）', () => {
    const summary = createMultiFilePatchSummary();
    const wrapper = mountSummary(summary);
    const text = wrapper.text();

    // modified 文件
    expect(text).toContain('+12');
    expect(text).toContain('-4');
    // added 文件
    expect(text).toContain('+8');
    // deleted 文件
    expect(text).toContain('-3');
  });

  it('应展示 patchRef 作为可追溯的引用标识', () => {
    const summary = createMultiFilePatchSummary();
    const wrapper = mountSummary(summary);

    expect(wrapper.text()).toContain(summary.patchRef);
  });

  it('summary props 变更后，组件应响应式地刷新展示内容', async () => {
    const wrapper = mountSummary(createPatchSummary());

    expect(wrapper.text()).toContain('src/agent/runtime.ts');
    expect(wrapper.text()).toContain('patch:run-1:step-1');

    await wrapper.setProps({
      summary: createPatchSummary({
        patchRef: 'patch:run-1:step-9',
        files: [
          {
            path: 'src/agent/another.ts',
            status: 'modified',
            additions: 1,
            deletions: 1,
            diffRef: 'diff:another',
            rollbackRef: 'rollback:another',
          },
        ],
      }),
    });

    expect(wrapper.text()).toContain('src/agent/another.ts');
    expect(wrapper.text()).toContain('patch:run-1:step-9');
    expect(wrapper.text()).not.toContain('src/agent/runtime.ts');
  });
});
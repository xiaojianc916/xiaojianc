import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AiDiffPreviewEditor from '@/components/business/ai/edit/AiDiffPreviewEditor.vue';
import type { IAiDiffEditorPreview } from '@/types/ai';

const createPreview = (): IAiDiffEditorPreview => ({
  id: 'ai-diff:diff-runtime',
  title: 'runtime.ts (AI Diff)',
  filePath: 'src/agent/runtime.ts',
  diffRef: 'diff:runtime',
  patchRef: 'patch:run-1:step-1',
  hunks: [],
});

describe('AiDiffPreviewEditor', () => {
  it('在编辑区展示独立 AI Diff 预览页和 ref 占位', () => {
    const wrapper = mount(AiDiffPreviewEditor, {
      props: {
        preview: createPreview(),
      },
    });

    expect(wrapper.text()).toContain('AI Diff Preview');
    expect(wrapper.text()).toContain('src/agent/runtime.ts');
    expect(wrapper.text()).toContain('diff:runtime');
    expect(wrapper.text()).toContain('patch:run-1:step-1');
    expect(wrapper.text()).toContain('按需拉取');
  });
});

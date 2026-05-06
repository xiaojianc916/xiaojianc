import { Suggestion } from '@/components/ai-elements/suggestion';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

describe('Suggestion', () => {
  it('点击时把提示词作为 payload 抛出', async () => {
    const wrapper = mount(Suggestion, {
      props: {
        suggestion: '解释当前脚本',
      },
    });

    await wrapper.get('button').trigger('click');

    expect(wrapper.emitted('click')?.[0]).toEqual(['解释当前脚本']);
  });

  it('禁用时不触发点击事件', async () => {
    const wrapper = mount(Suggestion, {
      props: {
        suggestion: '修复 ShellCheck 报错',
        disabled: true,
      },
    });

    await wrapper.get('button').trigger('click');

    expect(wrapper.emitted('click')).toBeUndefined();
  });
});

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AiFloatingSuggestions from '@/components/business/ai/suggestion/AiFloatingSuggestions.vue';

describe('AiFloatingSuggestions', () => {
  it('按行渲染提示词并把选中项向外抛出', async () => {
    const wrapper = mount(AiFloatingSuggestions, {
      props: {
        targetWidth: 260,
        suggestions: ['解释当前脚本', '修复 ShellCheck 报错', '生成提交说明', '总结运行失败原因'],
      },
    });

    expect(wrapper.findAll('.ai-floating-suggestions__row').length).toBeGreaterThan(1);

    await wrapper.findAll('button')[1]?.trigger('click');

    expect(wrapper.emitted('select')?.[0]).toEqual(['修复 ShellCheck 报错']);
  });
});

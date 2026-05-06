import LinearContextMenu from '@/components/common/LinearContextMenu.vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

const flushUi = async (): Promise<void> => {
  await nextTick();
  await flushPromises();
  await nextTick();
  await flushPromises();
};

describe('LinearContextMenu', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('在 open 从 false 切换为 true 时渲染菜单内容', async () => {
    const wrapper = mount(LinearContextMenu, {
      attachTo: document.body,
      props: {
        open: false,
        x: 96,
        y: 128,
        theme: 'dark',
        submenuDirection: 'right',
        groups: [
          {
            key: 'clipboard',
            title: 'CLIPBOARD',
            items: [
              {
                key: 'copy',
                label: '复制',
                icon: 'copy',
                shortcut: ['Ctrl', 'C'],
              },
            ],
          },
        ],
      },
    });

    await wrapper.setProps({ open: true });
    await flushUi();

    expect(document.body.textContent).toContain('复制');
    expect(document.body.textContent).toContain('CLIPBOARD');

    wrapper.unmount();
  });
});

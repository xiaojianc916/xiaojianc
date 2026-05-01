import AiProviderSettings from '@/components/business/ai/AiProviderSettings.vue';
import type {
    IAiConfigPayload,
    IAiProviderSettingsActionFeedback,
} from '@/types/ai';
import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

const createGlobalMountOptions = () => ({
    global: {
        plugins: [createPinia()],
        stubs: {
            teleport: true,
        },
    },
});

const createConfig = (overrides: Partial<IAiConfigPayload> = {}): IAiConfigPayload => ({
    providerType: 'litellm',
    selectedModel: 'openai/gpt-5.5',
    baseUrl: 'http://127.0.0.1:4000/v1',
    isBaseUrlConfigured: true,
    hasCredentials: true,
    isConfigured: true,
    inlineCompletionEnabled: true,
    chatEnabled: true,
    agentEnabled: false,
    ...overrides,
});

describe('AiProviderSettings', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders vendor platforms while keeping the LiteLLM provider underneath', async () => {
        const draft = createConfig();

        const wrapper = mount(AiProviderSettings, {
            props: {
                open: true,
                config: createConfig(),
                draft,
                apiKey: '',
            },
            ...createGlobalMountOptions(),
        });

        await wrapper.get('[data-provider-id="deepseek"]').trigger('click');

        expect(draft.providerType).toBe('litellm');
        expect(draft.baseUrl).toBe('http://127.0.0.1:4000/v1');
        expect(draft.selectedModel).toBe('deepseek/deepseek-v4-pro');
        expect(wrapper.find('[data-provider-id="litellm"]').exists()).toBe(false);
    });

    it('switches model options by platform without rendering a custom model input', async () => {
        const draft = createConfig();

        const wrapper = mount(AiProviderSettings, {
            props: {
                open: true,
                config: createConfig(),
                draft,
                apiKey: '',
            },
            ...createGlobalMountOptions(),
        });

        await wrapper.get('[data-provider-id="anthropic"]').trigger('click');

        expect(draft.providerType).toBe('litellm');
        expect(draft.baseUrl).toBe('http://127.0.0.1:4000/v1');
        expect(draft.selectedModel).toBe('anthropic/claude-sonnet-4-6');
        expect(wrapper.find('.model-alias-input').exists()).toBe(false);

        await wrapper.get('[data-key="model"] .lr-select-trigger').trigger('click');
        expect(wrapper.text()).toContain('anthropic/claude-opus-4-7');
        expect(wrapper.text()).toContain('anthropic/claude-sonnet-4-6');
        expect(wrapper.find('.lr-option-meta').exists()).toBe(false);

        await wrapper
            .findAll('[role="option"]')
            .find((option) => option.text().includes('anthropic/claude-opus-4-7'))
            ?.trigger('click');

        expect(draft.selectedModel).toBe('anthropic/claude-opus-4-7');
    });

    it('renders latest DeepSeek V4 model options and excludes deprecated aliases', async () => {
        const wrapper = mount(AiProviderSettings, {
            props: {
                open: true,
                config: createConfig(),
                draft: createConfig(),
                apiKey: '',
            },
            ...createGlobalMountOptions(),
        });

        await wrapper.get('[data-provider-id="deepseek"]').trigger('click');
        await wrapper.get('[data-key="model"] .lr-select-trigger').trigger('click');

        const text = wrapper.text();
        expect(text).toContain('deepseek/deepseek-v4-pro');
        expect(text).toContain('deepseek/deepseek-v4-flash');
        expect(text).not.toContain('deepseek-chat');
        expect(text).not.toContain('deepseek-reasoner');
    });

    it('renders inline feedback after the parent resolves the emitted callback', async () => {
        const wrapper = mount(AiProviderSettings, {
            props: {
                open: true,
                config: createConfig(),
                draft: createConfig(),
                apiKey: '',
            },
            ...createGlobalMountOptions(),
        });

        const testButton = wrapper
            .findAll('button')
            .find((button) => button.text().includes('测试连接'));

        expect(testButton).toBeDefined();

        await testButton!.trigger('click');

        const emitted = wrapper.emitted('testProvider');
        expect(emitted).toHaveLength(1);

        expect(emitted![0][0]).toMatchObject({ providerType: 'litellm' });
        expect(emitted![0][1]).toBe('');
        const feedback = emitted![0][2] as IAiProviderSettingsActionFeedback;
        feedback.onSuccess('连接成功，Provider 已响应');
        await nextTick();

        expect(wrapper.text()).toContain('连接成功，Provider 已响应');
        expect(wrapper.emitted('close')).toBeUndefined();
    });

    it('renders copy button without exposing the API Key visibility toggle', () => {
        const wrapper = mount(AiProviderSettings, {
            props: {
                open: true,
                config: createConfig(),
                draft: createConfig(),
                apiKey: 'sk-test-secret-value',
            },
            ...createGlobalMountOptions(),
        });

        expect(wrapper.find('[aria-label="复制"]').exists()).toBe(true);
        expect(wrapper.find('[aria-label="显示 / 隐藏"]').exists()).toBe(false);
        expect(wrapper.find('input[type="password"]').exists()).toBe(true);
    });

    it('keeps the dialog open after testing connection even after the success toast timeout', async () => {
        vi.useFakeTimers();
        const wrapper = mount(AiProviderSettings, {
            props: {
                open: true,
                config: createConfig(),
                draft: createConfig(),
                apiKey: '',
            },
            ...createGlobalMountOptions(),
        });

        const testButton = wrapper
            .findAll('button')
            .find((button) => button.text().includes('测试连接'));

        await testButton!.trigger('click');

        const feedback = wrapper.emitted('testProvider')![0][2] as IAiProviderSettingsActionFeedback;
        feedback.onSuccess('连接测试通过');
        await nextTick();
        vi.advanceTimersByTime(2400);
        await nextTick();

        expect(wrapper.emitted('close')).toBeUndefined();
    });

    it('only closes after start connection succeeds', async () => {
        vi.useFakeTimers();
        const wrapper = mount(AiProviderSettings, {
            props: {
                open: true,
                config: createConfig(),
                draft: createConfig(),
                apiKey: '',
            },
            ...createGlobalMountOptions(),
        });

        const saveButton = wrapper
            .findAll('button')
            .find((button) => button.text().includes('开始连接'));

        await saveButton!.trigger('click');
        const feedback = wrapper.emitted('save')![0][2] as IAiProviderSettingsActionFeedback;

        feedback.onError('连接失败');
        await nextTick();
        vi.advanceTimersByTime(2000);
        await nextTick();
        expect(wrapper.emitted('close')).toBeUndefined();

        await saveButton!.trigger('click');
        const successFeedback = wrapper.emitted('save')![1][2] as IAiProviderSettingsActionFeedback;
        successFeedback.onSuccess('连接成功');
        await nextTick();
        expect(wrapper.emitted('close')).toBeUndefined();

        vi.advanceTimersByTime(1200);
        await nextTick();
        expect(wrapper.emitted('close')).toHaveLength(1);
    });

    it('clicks the backdrop to close without rendering an explicit close button', async () => {
        const wrapper = mount(AiProviderSettings, {
            props: {
                open: true,
                config: createConfig(),
                draft: createConfig(),
                apiKey: '',
            },
            ...createGlobalMountOptions(),
        });

        expect(wrapper.find('.close-btn').exists()).toBe(false);

        await wrapper.get('.modal').trigger('click');
        expect(wrapper.emitted('close')).toBeUndefined();

        await wrapper.get('.modal-shell').trigger('click');
        expect(wrapper.emitted('close')).toHaveLength(1);
    });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

const aiServiceMock = vi.hoisted(() => ({
  getSuggestionPoolCache: vi.fn(),
  generateSuggestionPool: vi.fn(),
}));

vi.mock('@/services/modules/ai', () => ({
  aiService: aiServiceMock,
}));

import {
  AI_SUGGESTION_BATCH_SIZE,
  AI_SUGGESTION_POOL_SIZE,
  AI_SUGGESTION_REFRESH_INTERVAL_MS,
} from '@/constants/ai-suggestions';
import { useAiSuggestionPool } from '@/composables/useAiSuggestionPool';
import type { IAiSuggestionPoolPayload, IAiSuggestionPoolRequest } from '@/types/ai';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, ref, type Ref } from 'vue';

const createGeneratedPayload = (): IAiSuggestionPoolPayload => ({
  suggestions: Array.from(
    { length: AI_SUGGESTION_POOL_SIZE },
    (_value, index) => `模型提示词${index + 1}测试`,
  ),
  model: 'zhipu/glm-4-flash',
  generatedAt: '2026-05-06T00:00:00.000Z',
});

const createCachedPayload = (): IAiSuggestionPoolPayload => ({
  suggestions: Array.from(
    { length: AI_SUGGESTION_POOL_SIZE },
    (_value, index) => `缓存提示词${index + 1}测试`,
  ),
  model: 'zhipu/glm-4-flash',
  generatedAt: '2026-05-06T00:10:00.000Z',
});

const mountSuggestionPool = (params: {
  isRefreshEnabled: Ref<boolean>;
  getSuggestionPoolCache?: () => Promise<IAiSuggestionPoolPayload | null>;
  generateSuggestionPool: (payload: IAiSuggestionPoolRequest) => Promise<IAiSuggestionPoolPayload>;
}) => mount(defineComponent({
  setup() {
    const pool = useAiSuggestionPool({
      isRefreshEnabled: params.isRefreshEnabled,
      service: {
        getSuggestionPoolCache: params.getSuggestionPoolCache ?? (async () => null),
        generateSuggestionPool: params.generateSuggestionPool,
      },
      random: () => 0.42,
    });

    return {
      suggestions: pool.suggestions,
      refreshPool: pool.refreshPool,
    };
  },
  template: '<div>{{ suggestions.length }}</div>',
}));

describe('useAiSuggestionPool', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('默认从 90 条终极兜底池里取 9 条展示', async () => {
    const getSuggestionPoolCache = vi.fn(async () => null);
    const generateSuggestionPool = vi.fn<
      (payload: IAiSuggestionPoolRequest) => Promise<IAiSuggestionPoolPayload>
    >(async () => createGeneratedPayload());
    const wrapper = mountSuggestionPool({
      isRefreshEnabled: ref(false),
      getSuggestionPoolCache,
      generateSuggestionPool,
    });

    await flushPromises();

    const vm = wrapper.vm as unknown as { suggestions: string[] };

    expect(vm.suggestions).toHaveLength(AI_SUGGESTION_BATCH_SIZE);
    expect(getSuggestionPoolCache).toHaveBeenCalledTimes(1);
    expect(generateSuggestionPool).not.toHaveBeenCalled();
  });

  it('启动时优先使用上次小模型留下的提示词池缓存', async () => {
    const getSuggestionPoolCache = vi.fn(async () => createCachedPayload());
    const generateSuggestionPool = vi.fn<
      (payload: IAiSuggestionPoolRequest) => Promise<IAiSuggestionPoolPayload>
    >(async () => createGeneratedPayload());
    const wrapper = mountSuggestionPool({
      isRefreshEnabled: ref(false),
      getSuggestionPoolCache,
      generateSuggestionPool,
    });

    await flushPromises();

    const vm = wrapper.vm as unknown as { suggestions: string[] };

    expect(vm.suggestions).toHaveLength(AI_SUGGESTION_BATCH_SIZE);
    expect(vm.suggestions.some((suggestion) => suggestion.startsWith('缓存提示词'))).toBe(true);
    expect(generateSuggestionPool).not.toHaveBeenCalled();
  });

  it('小模型启用后刷新提示词池并保持每批 9 条', async () => {
    const generateSuggestionPool = vi.fn<
      (payload: IAiSuggestionPoolRequest) => Promise<IAiSuggestionPoolPayload>
    >(async () => createGeneratedPayload());
    const wrapper = mountSuggestionPool({
      isRefreshEnabled: ref(true),
      generateSuggestionPool,
    });

    await flushPromises();

    const vm = wrapper.vm as unknown as { suggestions: string[] };

    expect(generateSuggestionPool).toHaveBeenCalledWith(expect.objectContaining({
      count: AI_SUGGESTION_POOL_SIZE,
      locale: 'zh-CN',
    }));
    expect(vm.suggestions).toHaveLength(AI_SUGGESTION_BATCH_SIZE);
    expect(vm.suggestions.some((suggestion) => suggestion.startsWith('模型提示词'))).toBe(true);
  });

  it('小模型启用后每 10 分钟后台刷新一次', async () => {
    vi.useFakeTimers();

    const generateSuggestionPool = vi.fn<
      (payload: IAiSuggestionPoolRequest) => Promise<IAiSuggestionPoolPayload>
    >(async () => createGeneratedPayload());
    mountSuggestionPool({
      isRefreshEnabled: ref(true),
      generateSuggestionPool,
    });

    await flushPromises();
    expect(generateSuggestionPool).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(AI_SUGGESTION_REFRESH_INTERVAL_MS);
    await flushPromises();

    expect(generateSuggestionPool).toHaveBeenCalledTimes(2);
  });
});

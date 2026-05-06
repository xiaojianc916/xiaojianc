import {
  AI_ASSISTANT_FALLBACK_SUGGESTIONS,
  AI_SUGGESTION_BATCH_SIZE,
  AI_SUGGESTION_LOCALE,
  AI_SUGGESTION_POOL_SIZE,
  AI_SUGGESTION_REFRESH_INTERVAL_MS,
  AI_SUGGESTION_TOPICS,
} from '@/constants/ai-suggestions';
import { aiService } from '@/services/modules/ai';
import type { IAiSuggestionPoolPayload, IAiSuggestionPoolRequest } from '@/types/ai';
import { toErrorMessage } from '@/utils/error';
import {
  onScopeDispose,
  readonly,
  ref,
  watch,
  type Ref,
} from 'vue';

interface IAiSuggestionPoolService {
  getSuggestionPoolCache(): Promise<IAiSuggestionPoolPayload | null>;
  generateSuggestionPool(payload: IAiSuggestionPoolRequest): Promise<IAiSuggestionPoolPayload>;
}

interface IUseAiSuggestionPoolOptions {
  isRefreshEnabled?: Readonly<Ref<boolean>>;
  service?: IAiSuggestionPoolService;
  random?: () => number;
}

const normalizeSuggestionText = (value: string): string =>
  value
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim();

const normalizeSuggestionPool = (suggestions: readonly string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const suggestion of suggestions) {
    const normalizedSuggestion = normalizeSuggestionText(suggestion);

    if (!normalizedSuggestion) {
      continue;
    }

    const key = normalizedSuggestion.toLocaleLowerCase(AI_SUGGESTION_LOCALE);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalizedSuggestion);

    if (result.length >= AI_SUGGESTION_POOL_SIZE) {
      break;
    }
  }

  return result;
};

const getUltimateFallbackPool = (): string[] =>
  normalizeSuggestionPool(AI_ASSISTANT_FALLBACK_SUGGESTIONS);

const createDefaultRandom = (): (() => number) => () => {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return (values[0] ?? 0) / 0x100000000;
  }

  return Math.random();
};

const clampRandomValue = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(0.999999999, Math.max(0, value));
};

const pickSuggestionBatch = (
  suggestions: readonly string[],
  random: () => number,
): string[] => {
  const candidates = [...suggestions];

  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(clampRandomValue(random()) * (index + 1));
    const current = candidates[index];
    const swap = candidates[swapIndex];

    if (current === undefined || swap === undefined) {
      continue;
    }

    candidates[index] = swap;
    candidates[swapIndex] = current;
  }

  return candidates.slice(0, AI_SUGGESTION_BATCH_SIZE);
};

export const useAiSuggestionPool = (options: IUseAiSuggestionPoolOptions = {}) => {
  const service = options.service ?? aiService;
  const random = options.random ?? createDefaultRandom();
  const isRefreshEnabled = options.isRefreshEnabled ?? ref(false);
  const suggestionPool = ref<string[]>(getUltimateFallbackPool());
  const suggestions = ref<string[]>(pickSuggestionBatch(suggestionPool.value, random));
  const isRefreshing = ref(false);
  const refreshErrorMessage = ref('');
  let refreshTimer: ReturnType<typeof window.setInterval> | null = null;
  let cachedPoolPromise: Promise<void> | null = null;
  let hasLoadedCachedPool = false;

  const clearRefreshTimer = (): void => {
    if (refreshTimer === null || typeof window === 'undefined') {
      refreshTimer = null;
      return;
    }

    window.clearInterval(refreshTimer);
    refreshTimer = null;
  };

  const rotateBatch = (): void => {
    suggestions.value = pickSuggestionBatch(suggestionPool.value, random);
  };

  const applyLocalPool = (pool: readonly string[]): boolean => {
    const normalizedPool = normalizeSuggestionPool(pool);

    if (normalizedPool.length < AI_SUGGESTION_BATCH_SIZE) {
      return false;
    }

    suggestionPool.value = normalizedPool;
    rotateBatch();
    return true;
  };

  const loadCachedPool = async (): Promise<void> => {
    if (hasLoadedCachedPool) {
      return;
    }

    if (cachedPoolPromise) {
      await cachedPoolPromise;
      return;
    }

    cachedPoolPromise = (async () => {
      try {
        const payload = await service.getSuggestionPoolCache();

        if (payload) {
          applyLocalPool(payload.suggestions);
        }
      } catch (error) {
        console.warn(toErrorMessage(error, '读取提示词池缓存失败。'));
      } finally {
        hasLoadedCachedPool = true;
        cachedPoolPromise = null;
      }
    })();

    await cachedPoolPromise;
  };

  const refreshPool = async (): Promise<void> => {
    if (!isRefreshEnabled.value || isRefreshing.value) {
      return;
    }

    isRefreshing.value = true;

    try {
      const payload = await service.generateSuggestionPool({
        count: AI_SUGGESTION_POOL_SIZE,
        locale: AI_SUGGESTION_LOCALE,
        topics: [...AI_SUGGESTION_TOPICS],
      });
      const generatedPool = normalizeSuggestionPool(payload.suggestions);

      if (generatedPool.length < AI_SUGGESTION_BATCH_SIZE) {
        throw new Error('小模型返回的提示词数量不足，已保留本地提示词池。');
      }

      applyLocalPool(generatedPool);
      refreshErrorMessage.value = '';
    } catch (error) {
      refreshErrorMessage.value = toErrorMessage(error, '提示词池刷新失败。');
      console.warn(refreshErrorMessage.value);
    } finally {
      isRefreshing.value = false;
    }
  };

  const startRefreshTimer = (): void => {
    clearRefreshTimer();

    if (!isRefreshEnabled.value || typeof window === 'undefined') {
      return;
    }

    refreshTimer = window.setInterval(() => {
      void refreshPool();
    }, AI_SUGGESTION_REFRESH_INTERVAL_MS);
  };

  const stopEnabledWatcher = watch(
    () => isRefreshEnabled.value,
    (enabled) => {
      if (!enabled) {
        clearRefreshTimer();
        void loadCachedPool();
        return;
      }

      startRefreshTimer();
      void loadCachedPool().then(() => refreshPool());
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    clearRefreshTimer();
    stopEnabledWatcher();
  });

  return {
    suggestions: readonly(suggestions),
    isRefreshing: readonly(isRefreshing),
    refreshErrorMessage: readonly(refreshErrorMessage),
    rotateBatch,
    refreshPool,
  };
};

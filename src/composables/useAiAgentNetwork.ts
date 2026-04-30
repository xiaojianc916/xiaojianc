import { computed, ref, type ComputedRef, type Ref } from 'vue';

import { aiService } from '@/services/modules/ai';
import { useAiAgentStore } from '@/store/aiAgent';
import type { TAiAgentNetworkPermission } from '@/types/ai';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * 将任意 unknown 错误规范化为人类可读的字符串。
 * 兼容：Error 实例、string、带 message 字段的对象，否则回退到 fallback。
 */
const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  if (
    error !== null &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string' &&
    (error as { message: string }).message.trim()
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
};

const DEFAULT_ERROR_MESSAGE = '设置 AI Agent 网络权限失败。';

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export interface IUseAiAgentNetworkReturn {
  /** 直接暴露的 Pinia store，与原实现保持一致 */
  store: ReturnType<typeof useAiAgentStore>;
  /** 是否正在进行 setNetworkPermission 调用（响应式） */
  pending: Ref<boolean>;
  /** store.errorMessage 的只读响应式视图，便于在模板中直接绑定 */
  errorMessage: ComputedRef<string>;
  /** 主动清空当前错误信息 */
  clearError: () => void;
  /** 设置网络权限；签名与原实现一致 */
  setNetworkPermission: (
    permission: TAiAgentNetworkPermission,
  ) => Promise<TAiAgentNetworkPermission>;
}

export const useAiAgentNetwork = (): IUseAiAgentNetworkReturn => {
  const store = useAiAgentStore();

  // 用一个内部计数器追踪「最新一次」请求，避免过期请求覆盖更新的状态。
  // 注意：不改变对外语义，仍按原顺序执行 store 的写入。
  let requestSeq = 0;
  const pending = ref(false);

  const errorMessage = computed<string>(() => store.errorMessage ?? '');

  const clearError = (): void => {
    store.errorMessage = '';
  };

  const setNetworkPermission = async (
    permission: TAiAgentNetworkPermission,
  ): Promise<TAiAgentNetworkPermission> => {
    const seq = ++requestSeq;
    pending.value = true;

    try {
      const payload = await aiService.setNetworkPermission({ permission });

      // 只有「最新一次」请求才允许写回 store，避免被旧请求覆盖。
      // 在没有并发的常规场景下，行为与原实现完全一致。
      if (seq === requestSeq) {
        store.setNetworkPermission(payload.permission);
        store.errorMessage = '';
      }

      return payload.permission;
    } catch (error) {
      if (seq === requestSeq) {
        store.errorMessage = toErrorMessage(error, DEFAULT_ERROR_MESSAGE);
      }
      throw error;
    } finally {
      // 仅当我们仍是「最新一次」时才把 pending 置回 false，
      // 否则交给后续更新的那次请求自己管理。
      if (seq === requestSeq) {
        pending.value = false;
      }
    }
  };

  return {
    store,
    pending,
    errorMessage,
    clearError,
    setNetworkPermission,
  };
};
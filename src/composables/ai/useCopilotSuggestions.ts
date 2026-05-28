/**
 * useCopilotSuggestions — replaces useAiSuggestionPool with CopilotKit's
 * suggestion infrastructure. Provides the same `suggestions: Ref<string[]>`
 * interface so AiFloatingSuggestions can consume it without template changes.
 */
import type { Suggestion } from '@copilotkit/core';
import { useConfigureSuggestions, useSuggestions } from '@copilotkit/vue';
import { computed, type Ref, readonly, ref } from 'vue';

// ---------------------------------------------------------------------------
// Static suggestions — served by CopilotKit instead of the narrator model.
// ---------------------------------------------------------------------------
const STATIC_SUGGESTIONS: Suggestion[] = [
  { title: '解释代码', message: '请解释当前文件的代码逻辑', isLoading: false },
  { title: '优化代码', message: '请分析当前代码并给出优化建议', isLoading: false },
  { title: '写注释', message: '请为当前代码添加详细的中文注释', isLoading: false },
  { title: '找 Bug', message: '请检查当前代码是否存在潜在问题', isLoading: false },
  { title: '写单测', message: '请为当前代码编写单元测试', isLoading: false },
  { title: '重构建议', message: '请给出当前代码的重构建议', isLoading: false },
];

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------
export const useCopilotSuggestions = (): {
  suggestions: Ref<string[]>;
  rotateBatch: () => void;
} => {
  // Configure static suggestions
  useConfigureSuggestions({
    suggestions: STATIC_SUGGESTIONS,
    available: 'before-first-message',
  });

  const { suggestions: raw } = useSuggestions({ agentId: 'default' });

  const suggestions = computed<string[]>(() =>
    raw.value
      .filter((s: Suggestion) => s.message.trim().length > 0)
      .map((s: Suggestion) => s.message),
  );

  const rotateBatch = (): void => {
    // Static suggestions are not rotated; this is a no-op compatibility shim.
  };

  return {
    suggestions: readonly(suggestions),
    rotateBatch,
  };
};

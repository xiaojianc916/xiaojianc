import type { Suggestion } from '@copilotkit/core';
import { useConfigureSuggestions, useSuggestions } from '@copilotkit/vue';
import { computed, type Ref, readonly, ref } from 'vue';

const STATIC: Suggestion[] = [
  { title: '解释代码', message: '请解释当前文件的代码逻辑', isLoading: false },
  { title: '优化代码', message: '请分析当前代码并给出优化建议', isLoading: false },
  { title: '写注释', message: '请为当前代码添加详细的中文注释', isLoading: false },
  { title: '找 Bug', message: '请检查当前代码是否存在潜在问题', isLoading: false },
  { title: '写单测', message: '请为当前代码编写单元测试', isLoading: false },
  { title: '重构建议', message: '请给出当前代码的重构建议', isLoading: false },
];

export interface IUseCopilotSuggestionsResult {
  suggestions: Ref<readonly Suggestion[]>;
  suggestionTexts: Ref<readonly string[]>;
}

export const useCopilotSuggestions = (): IUseCopilotSuggestionsResult => {
  let raw: Ref<Suggestion[]> = ref(STATIC) as unknown as Ref<Suggestion[]>;

  try {
    useConfigureSuggestions({ suggestions: STATIC, available: 'before-first-message' });
    ({ suggestions: raw } = useSuggestions({ agentId: 'default' }));
  } catch {
    // Provider absent — fall back to static suggestions.
  }

  const suggestions = computed<readonly Suggestion[]>(() =>
    raw.value.filter((s: Suggestion) => s.message.trim().length > 0),
  );

  const suggestionTexts = computed<readonly string[]>(() =>
    suggestions.value.map((s: Suggestion) => s.message),
  );

  return { suggestions, suggestionTexts };
};

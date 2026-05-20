<script setup lang="ts">
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion';
import { cn } from '@/lib/utils';
import { groupSuggestionsByEstimatedWidth } from '@/utils/suggestion-layout';
import { computed, type HTMLAttributes } from 'vue';

interface IAiSuggestionRow {
  id: string;
  suggestions: IAiSuggestionItem[];
}

interface IAiSuggestionItem {
  id: string;
  text: string;
}

const props = withDefaults(defineProps<{
  suggestions: readonly string[];
  class?: HTMLAttributes['class'];
  title?: string;
  targetWidth?: number;
  disabled?: boolean;
}>(), {
  class: undefined,
  title: '有什么我能帮你的吗？',
  targetWidth: 720,
  disabled: false,
});

const emit = defineEmits<{
  select: [suggestion: string];
}>();

const rows = computed<IAiSuggestionRow[]>(() => {
  const occurrenceBySuggestion = new Map<string, number>();

  return groupSuggestionsByEstimatedWidth(props.suggestions, {
    targetWidth: props.targetWidth,
  }).map((suggestions) => {
    const items = suggestions.map((suggestion) => {
      const occurrence = occurrenceBySuggestion.get(suggestion) ?? 0;
      occurrenceBySuggestion.set(suggestion, occurrence + 1);

      return {
        id: `${suggestion}\u001f${occurrence}`,
        text: suggestion,
      };
    });

    return {
      id: items.map((item) => item.id).join('\u001e'),
      suggestions: items,
    };
  });
});

const hasRows = computed(() => rows.value.length > 0);

const handleSelect = (suggestion: string): void => {
  emit('select', suggestion);
};
</script>

<template>
  <section
    v-if="hasRows"
    :class="cn('ai-floating-suggestions', props.class)"
    aria-label="AI 提示词建议"
  >
    <h2 class="ai-floating-suggestions__title">{{ props.title }}</h2>
    <div class="ai-floating-suggestions__rows">
      <Suggestions
        v-for="row in rows"
        :key="row.id"
        class="ai-floating-suggestions__row"
      >
        <Suggestion
          v-for="suggestion in row.suggestions"
          :key="suggestion.id"
          :suggestion="suggestion.text"
          :disabled="props.disabled"
          @click="handleSelect"
        />
      </Suggestions>
    </div>
  </section>
</template>

<style scoped>
.ai-floating-suggestions {
  display: flex;
  width: 100%;
  min-width: 0;
  height: 100%;
  min-height: 242px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 26px;
  padding: 56px 24px 22px;
  color: var(--text-primary);
  transform: translateY(18px);
}

.ai-floating-suggestions__title {
  margin: 0;
  color: var(--text-primary);
  font-size: 28px;
  font-weight: 700;
  line-height: 34px;
  text-align: center;
}

.ai-floating-suggestions__rows {
  display: flex;
  width: min(100%, 860px);
  min-width: 0;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
}

.ai-floating-suggestions__row {
  width: 100%;
}

@media (max-width: 720px) {
  .ai-floating-suggestions {
    min-height: 220px;
    gap: 20px;
    padding: 38px 14px 20px;
    transform: translateY(10px);
  }

  .ai-floating-suggestions__title {
    font-size: 22px;
    line-height: 28px;
  }

  .ai-floating-suggestions__rows {
    gap: 10px;
  }

  .ai-floating-suggestions__row {
    flex-wrap: wrap;
  }
}
</style>

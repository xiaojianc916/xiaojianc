<script setup lang="ts">
import { computed } from 'vue';

import type {
  IAiToolConfirmationOption,
  IAiToolConfirmationRequest,
  TAiToolConfirmationDecision,
} from '@/types/ai';

const props = defineProps<{
  confirmation: IAiToolConfirmationRequest;
  disabled: boolean;
}>();

const emit = defineEmits<{
  resolve: [decision: TAiToolConfirmationDecision];
}>();

const visibleOptions = computed(() =>
  props.confirmation.options.filter((option) => option.id !== 'view-details'),
);

const riskLabel = computed(() => {
  switch (props.confirmation.riskLevel) {
    case 'high':
      return '高风险';
    case 'medium':
      return '中风险';
    case 'low':
      return '低风险';
    default:
      return '风险未知';
  }
});

const reversibleLabel = computed(() =>
  props.confirmation.reversible ? '可回滚' : '不可确认可回滚',
);

const getOptionClass = (option: IAiToolConfirmationOption): string => {
  const tone = option.tone ?? 'secondary';
  return `ai-tool-confirmation-option is-${tone}`;
};

const handleOptionClick = (option: IAiToolConfirmationOption): void => {
  if (option.id === 'view-details') {
    return;
  }

  emit('resolve', option.id);
};
</script>

<template>
  <section class="ai-tool-confirmation-card" aria-label="工具执行确认">
    <div class="ai-tool-confirmation-copy">
      <div class="ai-tool-confirmation-kicker">
        <span class="ai-tool-confirmation-dot" aria-hidden="true"></span>
        <span>{{ confirmation.toolName }}</span>
        <span>{{ riskLabel }}</span>
        <span>{{ reversibleLabel }}</span>
      </div>
      <h4>{{ confirmation.question }}</h4>
      <p>{{ confirmation.summary }}</p>
      <p v-if="confirmation.impact" class="ai-tool-confirmation-impact">
        {{ confirmation.impact }}
      </p>
    </div>
    <div class="ai-tool-confirmation-actions">
      <button
        v-for="option in visibleOptions"
        :key="option.id"
        type="button"
        :class="getOptionClass(option)"
        :disabled="disabled"
        @click="handleOptionClick(option)"
      >
        {{ option.label }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.ai-tool-confirmation-card {
  display: grid;
  gap: 9px;
  border: 1px solid color-mix(in srgb, var(--accent-strong) 32%, var(--shell-divider));
  border-radius: 10px;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--accent-strong) 9%, transparent),
      color-mix(in srgb, var(--surface-soft) 70%, transparent)
    );
  padding: 10px;
  transition:
    opacity 160ms cubic-bezier(0.23, 1, 0.32, 1),
    transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
}

.ai-tool-confirmation-copy {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.ai-tool-confirmation-kicker {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  color: var(--text-quaternary);
  font-size: 11px;
  line-height: 16px;
}

.ai-tool-confirmation-kicker span {
  min-width: 0;
}

.ai-tool-confirmation-kicker span:not(:first-child) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-tool-confirmation-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--accent-strong);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-strong) 14%, transparent);
}

.ai-tool-confirmation-card h4 {
  margin: 0;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
}

.ai-tool-confirmation-card p {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.ai-tool-confirmation-impact {
  color: var(--text-secondary);
}

.ai-tool-confirmation-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ai-tool-confirmation-option {
  height: 26px;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 86%, transparent);
  border-radius: 6px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  padding: 0 9px;
  transition:
    background-color 120ms cubic-bezier(0.23, 1, 0.32, 1),
    border-color 120ms cubic-bezier(0.23, 1, 0.32, 1),
    color 120ms cubic-bezier(0.23, 1, 0.32, 1),
    transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
}

.ai-tool-confirmation-option:hover:not(:disabled) {
  background: var(--surface-soft);
  color: var(--text-primary);
}

.ai-tool-confirmation-option:active:not(:disabled) {
  transform: scale(0.97);
}

.ai-tool-confirmation-option.is-primary {
  border-color: color-mix(in srgb, var(--accent-strong) 46%, var(--shell-divider));
  background: var(--accent-strong);
  color: var(--accent-foreground);
}

.ai-tool-confirmation-option.is-danger {
  border-color: color-mix(in srgb, var(--danger) 48%, var(--shell-divider));
  color: var(--danger);
}

.ai-tool-confirmation-option:disabled {
  cursor: wait;
  opacity: 0.58;
}

@media (prefers-reduced-motion: reduce) {
  .ai-tool-confirmation-card,
  .ai-tool-confirmation-option {
    transition: none;
  }
}
</style>

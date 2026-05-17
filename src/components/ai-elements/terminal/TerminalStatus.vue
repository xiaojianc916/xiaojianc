<script setup lang="ts">
import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'vue';
import { computed, inject } from 'vue';
import { TerminalKey } from './context';

const props = defineProps<{ class?: HTMLAttributes['class'] }>();
const terminal = inject(TerminalKey);
const label = computed(() => terminal?.isStreaming.value ? '运行中' : '已完成');
</script>

<template>
  <span :class="cn('ai-terminal-status', { 'is-streaming': terminal?.isStreaming.value }, props.class)" data-slot="terminal-status">
    <span class="ai-terminal-status__dot" aria-hidden="true" />
    <span>{{ label }}</span>
  </span>
</template>

<style scoped>
.ai-terminal-status {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  color: var(--terminal-muted);
  font-size: 11px;
  line-height: 16px;
}

.ai-terminal-status__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--terminal-muted);
}

.ai-terminal-status.is-streaming .ai-terminal-status__dot {
  background: var(--terminal-ansi-green);
}
</style>

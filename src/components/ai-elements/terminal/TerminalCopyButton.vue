<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { inject } from 'vue';
import { cn } from '@/lib/utils';
import Copy from '~icons/lucide/copy';
import { TerminalKey } from './context';

const props = defineProps<{ class?: HTMLAttributes['class'] }>();
const emit = defineEmits<{ copy: [] }>();
const terminal = inject(TerminalKey);

const handleCopy = async (): Promise<void> => {
  await terminal?.copyOutput();
  emit('copy');
};
</script>

<template>
  <button
    type="button"
    :class="cn('ai-terminal-icon-button', props.class)"
    aria-label="复制终端输出"
    title="复制终端输出"
    @click="handleCopy"
  >
    <Copy aria-hidden="true" />
  </button>
</template>

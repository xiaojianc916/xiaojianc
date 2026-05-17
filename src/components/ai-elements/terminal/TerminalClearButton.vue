<script setup lang="ts">
import { cn } from '@/lib/utils';
import Trash2 from '~icons/lucide/trash-2';
import type { HTMLAttributes } from 'vue';
import { inject } from 'vue';
import { TerminalKey } from './context';

const props = defineProps<{ class?: HTMLAttributes['class'] }>();
const terminal = inject(TerminalKey);

const handleClear = (): void => {
  terminal?.clearOutput();
};
</script>

<template>
  <button
    type="button"
    :class="cn('ai-terminal-icon-button', props.class)"
    aria-label="清空终端输出"
    title="清空终端输出"
    @click="handleClear"
  >
    <Trash2 aria-hidden="true" />
  </button>
</template>

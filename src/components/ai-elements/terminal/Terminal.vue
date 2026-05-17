<script setup lang="ts">
import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'vue';
import { computed, provide } from 'vue';
import { TerminalKey } from './context';

const props = withDefaults(defineProps<{
  output?: string;
  isStreaming?: boolean;
  autoScroll?: boolean;
  class?: HTMLAttributes['class'];
}>(), {
  output: '',
  isStreaming: false,
  autoScroll: true,
  class: undefined,
});

const emit = defineEmits<{
  clear: [];
  copy: [];
}>();

provide(TerminalKey, {
  output: computed(() => props.output),
  isStreaming: computed(() => props.isStreaming),
  autoScroll: computed(() => props.autoScroll),
  copyOutput: async () => {
    const text = props.output;

    if (text && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }

    emit('copy');
  },
  clearOutput: () => {
    emit('clear');
  },
});
</script>

<template>
  <section :class="cn('ai-terminal', props.class)" data-slot="terminal">
    <slot />
  </section>
</template>

<style scoped>
.ai-terminal {
  --terminal-background: #ededed;
  --terminal-header-background: #ededed;
  --terminal-border: #ededed;
  --terminal-text: #1f2328;
  --terminal-muted: #6f747b;
  --terminal-ansi-black: #1f2328;
  --terminal-ansi-red: #dc2626;
  --terminal-ansi-green: #16a34a;
  --terminal-ansi-yellow: #ca8a04;
  --terminal-ansi-blue: #2563eb;
  --terminal-ansi-magenta: #9333ea;
  --terminal-ansi-cyan: #0891b2;
  --terminal-ansi-white: #52525b;
  --terminal-ansi-bright-black: #71717a;
  display: flex;
  min-width: 0;
  height: 240px;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--terminal-border);
  border-radius: 10px;
  background: var(--terminal-background);
  color: var(--terminal-text);
}
</style>

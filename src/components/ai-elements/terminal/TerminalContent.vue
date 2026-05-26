<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { computed, inject, nextTick, ref, watch } from 'vue';
import { cn } from '@/lib/utils';
import { parseAnsiOutput } from './ansi';
import { TerminalKey } from './context';

const props = defineProps<{ class?: HTMLAttributes['class'] }>();
const terminal = inject(TerminalKey);
const contentRef = ref<HTMLElement | null>(null);

const output = computed(() => terminal?.output.value ?? '');
const tokens = computed(() => parseAnsiOutput(output.value));

const scrollToBottom = async (): Promise<void> => {
  if (!terminal?.autoScroll.value) {
    return;
  }

  await nextTick();

  if (contentRef.value) {
    contentRef.value.scrollTop = contentRef.value.scrollHeight;
  }
};

watch(
  output,
  () => {
    void scrollToBottom();
  },
  { immediate: true },
);
</script>

<template>
  <pre ref="contentRef" :class="cn('ai-terminal-content', props.class)" data-slot="terminal-content"><code><template v-if="output"><span
    v-for="(token, index) in tokens"
    :key="`${index}:${token.text.length}:${token.style}`"
    :style="token.style"
  >{{ token.text }}</span></template><span v-else class="ai-terminal-empty">暂无终端输出</span></code></pre>
</template>

<style scoped>
.ai-terminal-content {
  min-height: 0;
  flex: 1 1 auto;
  margin: 0;
  overflow: auto;
  background: var(--terminal-background);
  color: var(--terminal-text);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  line-height: 19px;
  padding: 8px 12px 30px;
  scrollbar-width: thin;
  white-space: pre-wrap;
  word-break: break-word;
}

.ai-terminal-content::-webkit-scrollbar {
  width: 9px;
  height: 9px;
}

.ai-terminal-content::-webkit-scrollbar-thumb {
  border: 2px solid var(--terminal-background);
  border-radius: 999px;
  background: color-mix(in srgb, #9ca3af 34%, transparent);
}

.ai-terminal-content::-webkit-scrollbar-track {
  background: transparent;
}

.ai-terminal-content code {
  font-family: inherit;
}

.ai-terminal-empty {
  color: var(--terminal-muted);
}
</style>

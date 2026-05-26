<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

const props = defineProps<{ class?: HTMLAttributes['class'] }>();
</script>

<template>
  <header :class="cn('ai-terminal-header', props.class)" data-slot="terminal-header">
    <slot />
  </header>
</template>

<style scoped>
.ai-terminal-header {
  display: flex;
  min-height: 30px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 0;
  background: var(--terminal-header-background);
  padding: 0 12px;
}
</style>

<script setup lang="ts">
import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'vue';

const props = defineProps<{ class?: HTMLAttributes['class'] }>();
</script>

<template>
  <div :class="cn('ai-terminal-title', props.class)" data-slot="terminal-title">
    <slot />
  </div>
</template>

<style scoped>
.ai-terminal-title {
  min-width: 0;
  overflow: hidden;
  color: var(--terminal-text);
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

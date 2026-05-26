<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

const props = defineProps<{ class?: HTMLAttributes['class'] }>();
</script>

<template>
  <div :class="cn('ai-terminal-actions', props.class)" data-slot="terminal-actions">
    <slot />
  </div>
</template>

<style scoped>
.ai-terminal-actions {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
}
</style>

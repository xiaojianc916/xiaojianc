<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes['class'];
  }>(),
  {
    class: undefined,
  },
);
</script>

<template>
  <div :class="cn('ai-suggestions-row', props.class)" v-bind="$attrs">
    <slot />
  </div>
</template>

<style scoped>
.ai-suggestions-row {
  display: flex;
  min-width: 0;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
</style>

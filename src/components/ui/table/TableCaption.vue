<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

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
    <caption :class="cn('text-muted-foreground mt-4 text-sm', props.class)">
        <slot />
    </caption>
</template>

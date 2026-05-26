<script setup lang="ts">
import type { HTMLAttributes, LabelHTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes['class'];
    for?: LabelHTMLAttributes['for'];
  }>(),
  {
    class: undefined,
    for: undefined,
  },
);
</script>

<template>
    <label data-slot="field-label" :for="props.for"
        :class="cn('text-foreground text-sm leading-6 font-medium', props.class)">
        <slot />
    </label>
</template>
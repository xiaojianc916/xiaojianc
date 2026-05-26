<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

const props = defineProps<{
  class?: HTMLAttributes['class'];
}>();
</script>

<template>
    <legend data-slot="field-legend" :class="cn('text-foreground text-sm leading-none font-semibold', props.class)">
        <slot />
    </legend>
</template>
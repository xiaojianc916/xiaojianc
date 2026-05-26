<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

const props = defineProps<{
  class?: HTMLAttributes['class'];
}>();
</script>

<template>
    <div data-slot="empty-description" :class="cn('text-sm leading-6 text-[var(--text-secondary)]', props.class)">
        <slot />
    </div>
</template>
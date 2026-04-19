<script setup lang="ts">
import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'vue';

const props = defineProps<{
  class?: HTMLAttributes['class'];
}>();
</script>

<template>
  <div
    data-slot="skeleton"
    :class="cn('app-skeleton animate-pulse rounded-md', props.class)"
  />
</template>
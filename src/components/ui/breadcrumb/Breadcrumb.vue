<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

const props = defineProps<{
  class?: HTMLAttributes['class'];
}>();
</script>

<template>
  <nav
    data-slot="breadcrumb"
    aria-label="breadcrumb"
    :class="cn(props.class)"
  >
    <slot />
  </nav>
</template>

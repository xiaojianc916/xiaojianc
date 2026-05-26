<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';
import BookmarkIcon from '~icons/lucide/bookmark';

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
  <slot v-if="$slots.default" />
  <BookmarkIcon v-else :class="cn('size-4 shrink-0', props.class)" v-bind="$attrs" />
</template>

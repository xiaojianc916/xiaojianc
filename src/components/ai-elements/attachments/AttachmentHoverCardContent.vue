<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { HoverCardContent } from '@/components/ui/hover-card';
import { cn } from '@/lib/utils';

interface IProps {
  class?: HTMLAttributes['class'];
  align?: 'start' | 'center' | 'end';
}

const props = withDefaults(defineProps<IProps>(), {
  class: undefined,
  align: 'start',
});
</script>

<template>
  <HoverCardContent
    :align="props.align"
    :class="cn('w-auto p-2', props.class)"
    v-bind="$attrs"
  >
    <slot />
  </HoverCardContent>
</template>

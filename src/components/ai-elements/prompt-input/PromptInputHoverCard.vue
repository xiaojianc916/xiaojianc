<script setup lang="ts">
import type { HoverCardRootProps } from 'reka-ui';
import { HoverCard } from '@/components/ui/hover-card';

interface Props extends HoverCardRootProps {
  openDelay?: number;
  closeDelay?: number;
}

const props = withDefaults(defineProps<Props>(), {
  openDelay: 0,
  closeDelay: 0,
});

const { openDelay, closeDelay, ...restProps } = props;
</script>

<template>
  <HoverCard :open-delay="openDelay" :close-delay="closeDelay" v-bind="restProps">
    <slot />
  </HoverCard>
</template>

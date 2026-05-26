<script setup lang="ts">
import { reactiveOmit } from '@vueuse/core';
import type { HoverCardContentProps } from 'reka-ui';
import { HoverCardContent } from '@/components/ui/hover-card';

const props = withDefaults(defineProps<HoverCardContentProps>(), {
  align: 'start',
});

const restProps = reactiveOmit(props, 'align');
</script>

<template>
  <HoverCardContent :align="props.align" v-bind="restProps">
    <slot />
  </HoverCardContent>
</template>

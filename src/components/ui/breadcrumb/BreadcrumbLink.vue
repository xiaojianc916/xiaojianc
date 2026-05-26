<script setup lang="ts">
import { Primitive, type PrimitiveProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<
    PrimitiveProps & {
      class?: HTMLAttributes['class'];
    }
  >(),
  {
    as: 'a',
    class: undefined,
  },
);
</script>

<template>
  <Primitive
    data-slot="breadcrumb-link"
    :as="props.as"
    :as-child="props.asChild"
    :class="cn('hover:text-foreground transition-colors', props.class)"
  >
    <slot />
  </Primitive>
</template>

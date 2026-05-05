<script setup lang="ts">
import type { SelectTriggerProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { SelectTrigger } from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface Props extends SelectTriggerProps {
  class?: HTMLAttributes['class'];
}

const props = defineProps<Props>();
</script>

<template>
  <SelectTrigger
    :class="
      cn(
        'border-none bg-transparent font-medium text-muted-foreground shadow-none transition-colors',
        'hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground',
        props.class,
      )
    "
    v-bind="props"
  >
    <slot />
  </SelectTrigger>
</template>

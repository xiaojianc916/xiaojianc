<script setup lang="ts">
import type { SelectValueProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface Props extends SelectValueProps {
  class?: HTMLAttributes['class'];
}

const props = defineProps<Props>();
</script>

<template>
  <SelectValue :class="cn(props.class)" v-bind="props">
    <slot />
  </SelectValue>
</template>

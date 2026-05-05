<script setup lang="ts">
import type { SelectContentProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { SelectContent } from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface Props extends SelectContentProps {
  class?: HTMLAttributes['class'];
}

const props = defineProps<Props>();
</script>

<template>
  <SelectContent :class="cn(props.class)" v-bind="props">
    <slot />
  </SelectContent>
</template>

<script setup lang="ts">
import { reactiveOmit } from '@vueuse/core';
import type { DropdownMenuContentProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import DropdownMenuContent from '@/components/ui/dropdown-menu/DropdownMenuContent.vue';
import { cn } from '@/lib/utils';

interface Props extends DropdownMenuContentProps {
  class?: HTMLAttributes['class'];
}

const props = withDefaults(defineProps<Props>(), {
  align: 'start',
  class: undefined,
});
const restProps = reactiveOmit(props, 'class');
</script>

<template>
  <DropdownMenuContent :class="cn(props.class)" v-bind="restProps">
    <slot />
  </DropdownMenuContent>
</template>

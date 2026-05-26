<script setup lang="ts">
import { useVModel } from '@vueuse/core';
import { type HTMLAttributes, provide, type Ref } from 'vue';
import { cn } from '@/lib/utils';
import { ChainOfThoughtContextKey } from './context';

interface IChainOfThoughtProps {
  modelValue?: boolean;
  defaultOpen?: boolean;
  class?: HTMLAttributes['class'];
}

const props = withDefaults(defineProps<IChainOfThoughtProps>(), {
  modelValue: undefined,
  defaultOpen: false,
  class: undefined,
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const isOpen = useVModel(props, 'modelValue', emit, {
  defaultValue: props.defaultOpen,
  passive: true,
});

provide(ChainOfThoughtContextKey, isOpen as Ref<boolean>);
</script>

<template>
  <div :class="cn('not-prose max-w-prose space-y-4', props.class)" v-bind="$attrs">
    <slot />
  </div>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

interface IProps {
  class?: HTMLAttributes['class'];
}

const props = defineProps<IProps>();
</script>

<template>
  <div
    :class="cn('flex items-center justify-center p-4 text-muted-foreground text-sm', props.class)"
    v-bind="$attrs"
  >
    <slot>暂无附件</slot>
  </div>
</template>

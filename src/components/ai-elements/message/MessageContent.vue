<script setup lang="ts">
import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'vue';

const props = withDefaults(defineProps<{
  class?: HTMLAttributes['class'];
}>(), {
  class: undefined,
});
</script>

<template>
  <div
    :class="cn('is-user:dark flex w-fit flex-col gap-2 overflow-hidden', 'group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground', 'group-[.is-assistant]:text-foreground', props.class)"
    v-bind="$attrs">
    <slot />
  </div>
</template>

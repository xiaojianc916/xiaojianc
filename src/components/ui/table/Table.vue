<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes['class'];
  }>(),
  {
    class: undefined,
  },
);
</script>

<template>
    <div class="relative inline-block max-w-full overflow-x-auto align-top">
        <table :class="cn('w-fit caption-bottom text-sm', props.class)">
            <slot />
        </table>
    </div>
</template>

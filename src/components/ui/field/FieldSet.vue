<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

const props = defineProps<{
  class?: HTMLAttributes['class'];
}>();
</script>

<template>
    <fieldset data-slot="field-set" :class="cn('m-0 min-w-0 border-0 p-0', props.class)">
        <slot />
    </fieldset>
</template>
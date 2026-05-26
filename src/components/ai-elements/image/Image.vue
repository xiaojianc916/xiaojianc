<script setup lang="ts">
import type { Experimental_GeneratedImage } from 'ai';
import { computed, type HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

interface IImageProps extends Experimental_GeneratedImage {
  class?: HTMLAttributes['class'];
}

const props = withDefaults(defineProps<IImageProps>(), {
  class: undefined,
});

const classes = computed(() => cn('h-auto max-w-full overflow-hidden rounded-md', props.class));

const src = computed(() => `data:${props.mediaType};base64,${props.base64}`);
</script>

<template>
  <img :class="classes" :src="src" v-bind="$attrs">
</template>

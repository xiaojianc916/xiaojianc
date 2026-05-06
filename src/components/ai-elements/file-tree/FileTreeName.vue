<script setup lang="ts">
import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'vue';

interface Props extends /* @vue-ignore */ HTMLAttributes {
    class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
    <span :class="cn('truncate', props.class)" data-slot="file-tree-name" v-bind="$attrs">
        <slot />
    </span>
</template>
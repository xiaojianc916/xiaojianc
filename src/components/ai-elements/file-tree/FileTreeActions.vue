<script setup lang="ts">
import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'vue';

interface Props extends /* @vue-ignore */ HTMLAttributes {
    class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
    <div
:class="cn('ml-auto flex items-center gap-1', props.class)" data-slot="file-tree-actions" role="group"
        v-bind="$attrs" @click.stop @keydown.enter.stop @keydown.space.stop>
        <slot />
    </div>
</template>
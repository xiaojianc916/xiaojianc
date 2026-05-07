<script setup lang="ts">
import { cn } from '@/lib/utils'
import type { HTMLAttributes } from 'vue'
import { provide, ref, watch } from 'vue'
import { FileTreeKey } from './context'

interface Props extends /* @vue-ignore */ HTMLAttributes {
    class?: HTMLAttributes['class']
    expanded?: Set<string>
    defaultExpanded?: Set<string>
    selectedPath?: string
}

const props = withDefaults(defineProps<Props>(), {
    defaultExpanded: () => new Set<string>(),
})

const emit = defineEmits<{
    (e: 'update:selectedPath', path: string): void
    (e: 'expandedChange', expanded: Set<string>): void
}>()

const internalExpanded = ref(new Set(props.defaultExpanded))
const internalSelectedPath = ref(props.selectedPath)

watch(
    () => props.expanded,
    (newVal) => {
        if (newVal) {
            internalExpanded.value = new Set(newVal)
        }
    },
    { immediate: true },
)

watch(
    () => props.selectedPath,
    (newVal) => {
        internalSelectedPath.value = newVal
    },
)

function togglePath(path: string) {
    const nextExpanded = new Set(internalExpanded.value)

    if (nextExpanded.has(path)) {
        nextExpanded.delete(path)
    } else {
        nextExpanded.add(path)
    }

    internalExpanded.value = nextExpanded
    emit('expandedChange', nextExpanded)
}

function onSelect(path: string) {
    internalSelectedPath.value = path
    emit('update:selectedPath', path)
}

provide(FileTreeKey, {
    expandedPaths: internalExpanded,
    togglePath,
    selectedPath: internalSelectedPath,
    onSelect,
})
</script>

<template>
    <div
:class="cn('rounded-lg border bg-background font-mono text-sm', props.class)" data-slot="file-tree" role="tree"
        v-bind="$attrs">
        <div class="p-2">
            <slot />
        </div>
    </div>
</template>
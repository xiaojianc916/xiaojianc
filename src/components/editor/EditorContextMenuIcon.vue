<template>
  <LinearContextMenuIcon :icon="props.icon" />
</template>

<script setup lang="ts">
import LinearContextMenuIcon from '@/components/common/LinearContextMenuIcon.vue';
import type { TEditorContextMenuIcon } from '@/components/editor/editor-context-menu.types';

const props = defineProps<{
  icon: TEditorContextMenuIcon;
}>();
</script>

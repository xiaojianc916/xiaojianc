<template>
  <LinearContextMenu
    :open="props.open"
    :x="props.x"
    :y="props.y"
    :groups="props.groups"
    :theme="props.theme"
    :submenu-direction="props.submenuDirection"
    @select="handleSelect"
  />
</template>

<script setup lang="ts">
import LinearContextMenu from '@/components/common/LinearContextMenu.vue';
import type {
  IEditorContextMenuGroup,
  IEditorContextMenuItem,
} from '@/components/editor/editor-context-menu.types';
import type { TThemeMode } from '@/types/app';

const props = defineProps<{
  open: boolean;
  x: number;
  y: number;
  groups: IEditorContextMenuGroup[];
  theme: TThemeMode;
  submenuDirection: 'left' | 'right';
}>();

const emit = defineEmits<{
  select: [item: IEditorContextMenuItem];
}>();

const handleSelect = (item: IEditorContextMenuItem): void => {
  emit('select', item);
};
</script>

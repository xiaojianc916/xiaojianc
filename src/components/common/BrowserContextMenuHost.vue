<template>
  <LinearContextMenu
    :open="contextMenuState.open"
    :x="contextMenuState.x"
    :y="contextMenuState.y"
    :groups="contextMenuGroups"
    :theme="appStore.theme"
    submenu-direction="right"
    @select="handleContextMenuItemSelect"
  />
</template>

<script setup lang="ts">
import LinearContextMenu from '@/components/common/LinearContextMenu.vue';
import type { ILinearContextMenuItem } from '@/components/common/linear-context-menu.types';
import { useBrowserContextMenu } from '@/composables/useBrowserContextMenu';
import { useAppStore } from '@/store/app';

const appStore = useAppStore();
const { contextMenuState, contextMenuGroups, executeContextMenuItem } = useBrowserContextMenu();

const handleContextMenuItemSelect = (item: ILinearContextMenuItem): void => {
  void executeContextMenuItem(item);
};
</script>

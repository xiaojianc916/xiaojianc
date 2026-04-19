<template>
  <div>
    <button
      type="button"
      class="explorer-tree-row w-full text-left"
      :class="{ 'is-active': isActive }"
      :style="rowStyle"
      @click="handleClick"
    >
      <span
        class="explorer-chevron"
        :class="{ 'is-placeholder': !isDirectory || (!entry.hasChildren && !isExpanded) }"
      >
        <svg
          v-if="isDirectory"
          viewBox="0 0 12 12"
          class="h-3 w-3 transition-transform"
          :class="isExpanded ? 'rotate-90' : ''"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M4 2.5 8 6 4 9.5" />
        </svg>
      </span>

      <FileEntryIcon
        :kind="entry.kind"
        :path="entry.path"
        :expanded="isExpanded"
        class="h-4 w-4 shrink-0"
      />

      <span class="min-w-0 flex-1 truncate">{{ entry.name }}</span>
    </button>

    <div v-if="isDirectory && isExpanded">
      <div v-if="isLoading" class="explorer-helper-text" :style="childStateStyle">正在读取目录...</div>
      <div v-else-if="childEntries.length === 0" class="explorer-helper-text" :style="childStateStyle">空文件夹</div>

      <WorkspaceTreeNode
        v-for="child in childEntries"
        :key="child.path"
        :entry="child"
        :level="level + 1"
        :children-map="childrenMap"
        :expanded-paths="expandedPaths"
        :loading-paths="loadingPaths"
        :active-path="activePath"
        :active-dirty="activeDirty"
        @toggle-directory="$emit('toggle-directory', $event)"
        @open-file="$emit('open-file', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import FileEntryIcon from '@/components/common/FileEntryIcon.vue';
import type { IWorkspaceEntry } from '@/types/editor';
import type { CSSProperties } from 'vue';
import { computed } from 'vue';

defineOptions({
  name: 'WorkspaceTreeNode',
});

const props = defineProps<{
  entry: IWorkspaceEntry;
  level: number;
  childrenMap: Record<string, IWorkspaceEntry[]>;
  expandedPaths: Record<string, boolean>;
  loadingPaths: Record<string, boolean>;
  activePath: string | null;
  activeDirty: boolean;
}>();

const emit = defineEmits<{
  'toggle-directory': [path: string];
  'open-file': [path: string];
}>();

const normalizePath = (value: string | null | undefined): string =>
  value ? value.replace(/\\/g, '/').toLowerCase() : '';

const isDirectory = computed(() => props.entry.kind === 'directory');
const isExpanded = computed(() => Boolean(props.expandedPaths[props.entry.path]));
const isLoading = computed(() => Boolean(props.loadingPaths[props.entry.path]));
const childEntries = computed(() => props.childrenMap[props.entry.path] ?? []);
const isActive = computed(
  () => normalizePath(props.entry.path) === normalizePath(props.activePath),
);
const rowStyle = computed<CSSProperties>(() => ({
  paddingLeft: `${12 + props.level * 14}px`,
}));
const childStateStyle = computed<CSSProperties>(() => ({
  paddingLeft: `${40 + props.level * 14}px`,
}));

const handleClick = (): void => {
  if (isDirectory.value) {
    emit('toggle-directory', props.entry.path);
    return;
  }

  emit('open-file', props.entry.path);
};
</script>

<script setup lang="ts">
import { computed } from 'vue';

import type {
  IAiAgentChangedFile,
  IAiAgentPatchSummary,
  TAiAgentChangedFileStatus,
} from '@/types/ai';

const props = defineProps<{
  summary: IAiAgentPatchSummary;
}>();

const emit = defineEmits<{
  viewDiff: [diffRef: string, filePath: string];
}>();

const FILE_STATUS_LABELS: Record<TAiAgentChangedFileStatus, string> = {
  added: '新增',
  modified: '修改',
  deleted: '删除',
  renamed: '重命名',
};

const changedFileCountLabel = computed(() => `${props.summary.files.length} 个文件`);

const getFileStatusLabel = (status: TAiAgentChangedFileStatus): string =>
  FILE_STATUS_LABELS[status];

const getFileStatLabel = (file: IAiAgentChangedFile): string =>
  `+${file.additions} -${file.deletions}`;

const handleViewDiff = (file: IAiAgentChangedFile): void => {
  emit('viewDiff', file.diffRef, file.path);
};
</script>

<template>
  <section class="ai-changed-files-summary" aria-label="Files changed">
    <header class="ai-changed-files-header">
      <div class="ai-changed-files-title">
        <strong>Files changed</strong>
        <span>{{ changedFileCountLabel }}</span>
      </div>
      <div class="ai-changed-files-total" aria-label="total diff stat">
        <span class="is-add">+{{ summary.totalAdditions }}</span>
        <span class="is-delete">-{{ summary.totalDeletions }}</span>
      </div>
    </header>

    <ul class="ai-changed-file-list">
      <li
        v-for="file in summary.files"
        :key="`${summary.id}:${file.path}:${file.diffRef}`"
        class="ai-changed-file-item"
        :class="`is-${file.status}`"
      >
        <div class="ai-changed-file-copy">
          <span class="ai-changed-file-status">{{ getFileStatusLabel(file.status) }}</span>
          <strong>{{ file.path }}</strong>
          <em>{{ getFileStatLabel(file) }}</em>
        </div>
        <button
          type="button"
          class="ai-changed-file-action"
          @click="handleViewDiff(file)"
        >
          查看 Diff
        </button>
      </li>
    </ul>

    <footer class="ai-changed-files-footer">
      <span>patchRef: {{ summary.patchRef }}</span>
      <span v-if="summary.revertedAt">已回滚：{{ summary.revertedAt }}</span>
      <span v-else-if="summary.appliedAt">已应用：{{ summary.appliedAt }}</span>
    </footer>
  </section>
</template>

<style scoped>
.ai-changed-files-summary {
  display: grid;
  gap: 7px;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 76%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-soft) 48%, transparent);
  padding: 8px;
}

.ai-changed-files-header,
.ai-changed-file-item,
.ai-changed-file-copy,
.ai-changed-files-total,
.ai-changed-files-footer {
  display: flex;
  min-width: 0;
  align-items: center;
}

.ai-changed-files-header,
.ai-changed-file-item {
  justify-content: space-between;
  gap: 8px;
}

.ai-changed-files-title {
  display: inline-flex;
  min-width: 0;
  align-items: baseline;
  gap: 7px;
}

.ai-changed-files-title strong {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
}

.ai-changed-files-title span,
.ai-changed-files-footer {
  color: var(--text-quaternary);
  font-size: 11px;
}

.ai-changed-files-total {
  flex: 0 0 auto;
  gap: 6px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.ai-changed-files-total .is-add,
.ai-changed-file-copy em {
  color: var(--success);
}

.ai-changed-files-total .is-delete {
  color: var(--danger);
}

.ai-changed-file-list {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ai-changed-file-item {
  border-radius: 6px;
  padding: 4px 0;
}

.ai-changed-file-copy {
  flex: 1 1 auto;
  gap: 6px;
}

.ai-changed-file-status {
  flex: 0 0 auto;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 72%, transparent);
  border-radius: 999px;
  color: var(--text-quaternary);
  font-size: 10px;
  line-height: 14px;
  padding: 0 6px;
}

.ai-changed-file-copy strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-changed-file-copy em {
  flex: 0 0 auto;
  font-size: 11px;
  font-style: normal;
  line-height: 16px;
}

.ai-changed-file-item.is-deleted .ai-changed-file-copy em {
  color: var(--danger);
}

.ai-changed-file-action {
  height: 22px;
  flex: 0 0 auto;
  border-radius: 6px;
  color: var(--text-quaternary);
  font-size: 11px;
  padding: 0 7px;
  transition:
    color 120ms cubic-bezier(0.23, 1, 0.32, 1),
    transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
}

.ai-changed-file-action:hover {
  background: var(--surface-soft);
  color: var(--text-primary);
}

.ai-changed-file-action:active {
  transform: scale(0.97);
}

.ai-changed-files-footer {
  flex-wrap: wrap;
  gap: 7px;
  line-height: 16px;
}
</style>

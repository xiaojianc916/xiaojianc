<script setup lang="ts">
import type { IAiDiffHunkPreview, TAiDiffPreviewLineKind } from '@/types/ai';

defineProps<{
  hunk: IAiDiffHunkPreview;
}>();

const LINE_KIND_LABELS: Record<TAiDiffPreviewLineKind, string> = {
  add: '+',
  delete: '-',
  hunk: '@',
  context: ' ',
};

const getLineSign = (kind: TAiDiffPreviewLineKind): string => LINE_KIND_LABELS[kind];

const getLineNumber = (lineNumber?: number): string =>
  typeof lineNumber === 'number' ? String(lineNumber) : '';
</script>

<template>
  <section class="ai-diff-hunk-viewer" aria-label="Diff hunk preview">
    <header class="ai-diff-hunk-header">
      <strong>{{ hunk.filePath }}</strong>
      <span>{{ hunk.diffRef }}</span>
    </header>
    <div class="ai-diff-hunk-body">
      <div class="ai-diff-hunk-line is-hunk">
        <span aria-hidden="true"></span>
        <span aria-hidden="true"></span>
        <code>{{ hunk.header }}</code>
      </div>
      <div
        v-for="line in hunk.lines"
        :key="line.id"
        class="ai-diff-hunk-line"
        :class="`is-${line.kind}`"
      >
        <span aria-label="old line">{{ getLineNumber(line.oldLineNumber) }}</span>
        <span aria-label="new line">{{ getLineNumber(line.newLineNumber) }}</span>
        <code>
          <span class="ai-diff-hunk-sign" aria-hidden="true">{{ getLineSign(line.kind) }}</span>{{ line.content }}
        </code>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ai-diff-hunk-viewer {
  display: grid;
  min-width: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 76%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--panel-bg) 86%, transparent);
}

.ai-diff-hunk-header {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--shell-divider) 76%, transparent);
  padding: 7px 8px;
}

.ai-diff-hunk-header strong,
.ai-diff-hunk-header span {
  min-width: 0;
  overflow: hidden;
  font-size: 11px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-diff-hunk-header strong {
  color: var(--text-secondary);
  font-weight: 600;
}

.ai-diff-hunk-header span {
  color: var(--text-quaternary);
}

.ai-diff-hunk-body {
  max-height: 220px;
  overflow: auto;
  padding: 5px 0;
  scrollbar-color: color-mix(in srgb, var(--text-primary) 12%, transparent) transparent;
  scrollbar-width: thin;
}

.ai-diff-hunk-line {
  display: grid;
  grid-template-columns: 34px 34px minmax(0, 1fr);
  min-width: max-content;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 18px;
}

.ai-diff-hunk-line.is-add {
  background: color-mix(in srgb, var(--success) 12%, transparent);
}

.ai-diff-hunk-line.is-delete {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.ai-diff-hunk-line.is-hunk {
  background: color-mix(in srgb, var(--accent-strong) 10%, transparent);
  color: var(--accent-strong);
}

.ai-diff-hunk-line > span {
  user-select: none;
  color: var(--text-quaternary);
  padding-right: 7px;
  text-align: right;
}

.ai-diff-hunk-line code {
  padding-right: 10px;
  white-space: pre;
}

.ai-diff-hunk-sign {
  display: inline-block;
  width: 14px;
  color: var(--text-quaternary);
}

.ai-diff-hunk-line.is-add .ai-diff-hunk-sign {
  color: var(--success);
}

.ai-diff-hunk-line.is-delete .ai-diff-hunk-sign {
  color: var(--danger);
}
</style>

<script setup lang="ts">
import AiDiffHunkViewer from '@/components/business/ai/AiDiffHunkViewer.vue';
import { useAiDiffPreview } from '@/composables/useAiDiffPreview';
import type { IAiDiffEditorPreview } from '@/types/ai';
import { computed, onMounted, watch } from 'vue';

const props = defineProps<{
  preview: IAiDiffEditorPreview;
}>();

const previewRef = computed(() => props.preview);
const {
  displayPreview,
  isLoading,
  errorMessage,
  load,
} = useAiDiffPreview(previewRef);

watch(
  () => props.preview.id,
  () => {
    void load();
  },
);

onMounted(() => {
  void load();
});
</script>

<template>
  <section class="ai-diff-preview-editor" aria-label="AI Diff Preview">
    <header class="ai-diff-preview-header">
      <div class="ai-diff-preview-title">
        <span>AI Diff Preview</span>
        <strong>{{ displayPreview.filePath }}</strong>
      </div>
      <div class="ai-diff-preview-refs">
        <span>diffRef: {{ displayPreview.diffRef }}</span>
        <span v-if="displayPreview.patchRef">patchRef: {{ displayPreview.patchRef }}</span>
      </div>
    </header>

    <div v-if="displayPreview.hunks.length" class="ai-diff-preview-hunks">
      <AiDiffHunkViewer
        v-for="hunk in displayPreview.hunks"
        :key="hunk.id"
        :hunk="hunk"
      />
    </div>

    <section v-else class="ai-diff-preview-empty">
      <strong>等待加载 Diff 正文</strong>
      <p>
        当前编辑区已打开独立 Diff 预览页。完整 diff 不进入 Pinia，将通过 diffRef 按需拉取。
      </p>
      <code>{{ displayPreview.diffRef }}</code>
      <p v-if="isLoading">正在加载 Diff hunk…</p>
      <p v-else-if="errorMessage" class="is-error">{{ errorMessage }}</p>
    </section>
  </section>
</template>

<style scoped>
.ai-diff-preview-editor {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  background: var(--editor-bg);
  color: var(--text-primary);
}

.ai-diff-preview-header {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--shell-divider);
  padding: 12px 16px;
}

.ai-diff-preview-title,
.ai-diff-preview-refs {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.ai-diff-preview-title span,
.ai-diff-preview-refs span {
  color: var(--text-quaternary);
  font-size: 11px;
  line-height: 16px;
}

.ai-diff-preview-title strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-diff-preview-refs {
  max-width: 42%;
  text-align: right;
}

.ai-diff-preview-refs span {
  overflow-wrap: anywhere;
}

.ai-diff-preview-hunks {
  display: grid;
  align-content: start;
  gap: 10px;
  min-height: 0;
  overflow: auto;
  padding: 14px 16px;
}

.ai-diff-preview-empty {
  align-self: start;
  display: grid;
  gap: 8px;
  max-width: 520px;
  margin: 28px 16px;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 78%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface-soft) 42%, transparent);
  padding: 14px;
}

.ai-diff-preview-empty strong {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
}

.ai-diff-preview-empty p,
.ai-diff-preview-empty code {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.ai-diff-preview-empty .is-error {
  color: var(--danger);
}

.ai-diff-preview-empty code {
  color: var(--text-quaternary);
  overflow-wrap: anywhere;
}
</style>

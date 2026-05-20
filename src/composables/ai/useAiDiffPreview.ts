import { aiService } from '@/services/ipc/ai.service';
import type {
  IAiDiffEditorPreview,
  IAiDiffHunkPreview,
  IAiDiffPreviewLine,
  TAiDiffPreviewLineKind,
} from '@/types/ai';
import type { IAiEditDiffHunk, IAiEditGetDiffPayload } from '@/types/ai/edit';
import { parseAiAedDiffRef } from '@/components/business/ai/edit/diff-ref';
import { computed, ref, type Ref } from 'vue';

const getDiffLineKind = (line: string): TAiDiffPreviewLineKind => {
  if (line.startsWith('+')) {
    return 'add';
  }

  if (line.startsWith('-')) {
    return 'delete';
  }

  if (line.startsWith('@@')) {
    return 'hunk';
  }

  return 'context';
};

const getDiffLineContent = (line: string): string => {
  if (line.startsWith('+') || line.startsWith('-')) {
    return line.slice(1);
  }

  return line;
};

const buildLinePreview = (
  hunk: IAiEditDiffHunk,
  line: string,
  index: number,
  cursors: { oldLineNumber: number; newLineNumber: number },
): IAiDiffPreviewLine => {
  const kind = getDiffLineKind(line);
  const item: IAiDiffPreviewLine = {
    id: `hunk-${hunk.hunkIndex}:line-${index}`,
    kind,
    content: getDiffLineContent(line),
  };

  if (kind === 'add') {
    item.newLineNumber = cursors.newLineNumber;
    cursors.newLineNumber += 1;
    return item;
  }

  if (kind === 'delete') {
    item.oldLineNumber = cursors.oldLineNumber;
    cursors.oldLineNumber += 1;
    return item;
  }

  item.oldLineNumber = cursors.oldLineNumber;
  item.newLineNumber = cursors.newLineNumber;
  cursors.oldLineNumber += 1;
  cursors.newLineNumber += 1;
  return item;
};

const toHunkPreview = (
  payload: IAiEditGetDiffPayload,
  diffRef: string,
  hunk: IAiEditDiffHunk,
): IAiDiffHunkPreview => {
  const cursors = {
    oldLineNumber: hunk.oldStart,
    newLineNumber: hunk.newStart,
  };

  return {
    id: `${payload.operationId}:hunk-${hunk.hunkIndex}`,
    filePath: payload.path,
    diffRef,
    header: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    lines: hunk.lines.map((line, index) => buildLinePreview(hunk, line, index, cursors)),
  };
};

const toEditorPreview = (
  preview: IAiDiffEditorPreview,
  payload: IAiEditGetDiffPayload,
): IAiDiffEditorPreview => ({
  ...preview,
  filePath: payload.path,
  hunks: payload.hunks.map((hunk) => toHunkPreview(payload, preview.diffRef, hunk)),
});

export const useAiDiffPreview = (preview: Ref<IAiDiffEditorPreview>) => {
  const loadedPreview = ref<IAiDiffEditorPreview | null>(null);
  const isLoading = ref(false);
  const errorMessage = ref('');

  const displayPreview = computed(() => loadedPreview.value ?? preview.value);

  const load = async (): Promise<void> => {
    errorMessage.value = '';

    if (preview.value.hunks.length > 0) {
      loadedPreview.value = preview.value;
      return;
    }

    const target = parseAiAedDiffRef(preview.value.diffRef);
    if (!target) {
      loadedPreview.value = preview.value;
      return;
    }

    isLoading.value = true;
    try {
      const payload = await aiService.getEditDiff(target);
      loadedPreview.value = toEditorPreview(preview.value, payload);
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
      loadedPreview.value = preview.value;
    } finally {
      isLoading.value = false;
    }
  };

  return {
    displayPreview,
    isLoading,
    errorMessage,
    load,
  };
};

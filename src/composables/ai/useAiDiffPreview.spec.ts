import { computed } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import { aiService } from '@/services/ipc/ai.service';
import type { IAiDiffEditorPreview } from '@/types/ai';
import { useAiDiffPreview } from '@/composables/ai/useAiDiffPreview';
import { buildAiAedDiffRef } from '@/components/business/ai/edit/diff-ref';

vi.mock('@/services/ipc/ai.service', () => ({
  aiService: {
    getEditDiff: vi.fn(),
  },
}));

const createPreview = (diffRef: string): IAiDiffEditorPreview => ({
  id: 'preview-1',
  title: 'runtime.ts (AI Diff)',
  filePath: 'src/agent/runtime.ts',
  diffRef,
  hunks: [],
});

describe('useAiDiffPreview', () => {
  it('按 AED diffRef 拉取并转换 hunk preview', async () => {
    vi.mocked(aiService.getEditDiff).mockResolvedValueOnce({
      taskId: 'task-1',
      path: 'src/agent/runtime.ts',
      operationId: 'operation-1',
      kind: 'modify',
      additions: 1,
      deletions: 1,
      hunks: [{
        hunkIndex: 0,
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: [
          "-const mode = 'chat'",
          "+const mode = 'agent'",
        ],
      }],
    });
    const preview = computed(() => createPreview(buildAiAedDiffRef({
      taskId: 'task-1',
      path: 'src/agent/runtime.ts',
    })));
    const state = useAiDiffPreview(preview);

    await state.load();

    expect(aiService.getEditDiff).toHaveBeenCalledWith({
      taskId: 'task-1',
      path: 'src/agent/runtime.ts',
    });
    expect(state.displayPreview.value.hunks[0]?.header).toBe('@@ -1,1 +1,1 @@');
    expect(state.displayPreview.value.hunks[0]?.lines[0]?.kind).toBe('delete');
    expect(state.displayPreview.value.hunks[0]?.lines[1]?.content).toBe("const mode = 'agent'");
  });

  it('未知 diffRef 不调用后端', async () => {
    vi.mocked(aiService.getEditDiff).mockClear();
    const preview = computed(() => createPreview('diff:runtime'));
    const state = useAiDiffPreview(preview);

    await state.load();

    expect(aiService.getEditDiff).not.toHaveBeenCalled();
    expect(state.displayPreview.value.diffRef).toBe('diff:runtime');
  });
});

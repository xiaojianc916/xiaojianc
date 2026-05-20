import {
  aiAgentPatchSummarySchema,
  aiDiffHunkPreviewSchema,
} from '@/types/ai/patch.schema';
import { describe, expect, it } from 'vitest';

describe('AI patch schema', () => {
  it('校验 patch summary 只保存变更统计与 ref', () => {
    const parsed = aiAgentPatchSummarySchema.parse({
      id: 'patch-summary-1',
      runId: 'run-1',
      stepId: 'step-1',
      totalAdditions: 10,
      totalDeletions: 3,
      patchRef: 'patch:run-1:step-1',
      appliedAt: '2026-04-29T10:00:00.000Z',
      files: [{
        path: 'src/agent/runtime.ts',
        status: 'modified',
        additions: 10,
        deletions: 3,
        diffRef: 'diff:runtime',
        rollbackRef: 'rollback:runtime',
      }],
    });

    expect(parsed.files[0]?.diffRef).toBe('diff:runtime');
    expect(JSON.stringify(parsed)).not.toContain('完整 diff');
  });

  it('校验 diff hunk preview 支持小段预览但拒绝未知行类型', () => {
    const parsed = aiDiffHunkPreviewSchema.parse({
      id: 'hunk-1',
      filePath: 'src/agent/runtime.ts',
      diffRef: 'diff:runtime',
      header: '@@ -1,1 +1,1 @@',
      lines: [{
        id: 'line-1',
        kind: 'add',
        content: "+ const mode = 'agent'",
        newLineNumber: 1,
      }],
    });

    expect(parsed.lines[0]?.kind).toBe('add');
    expect(() =>
      aiDiffHunkPreviewSchema.parse({
        ...parsed,
        lines: [{
          id: 'line-2',
          kind: 'unknown',
          content: 'x',
        }],
      }),
    ).toThrow();
  });
});

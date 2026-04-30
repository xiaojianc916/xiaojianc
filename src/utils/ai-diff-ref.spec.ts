import { describe, expect, it } from 'vitest';

import { buildAiAedDiffRef, parseAiAedDiffRef } from '@/utils/ai-diff-ref';

describe('ai diff ref', () => {
  it('构建并解析 AED diffRef', () => {
    const ref = buildAiAedDiffRef({
      taskId: 'task-1',
      path: 'D:\\workspace\\src\\agent\\runtime.ts',
    });

    expect(parseAiAedDiffRef(ref)).toEqual({
      taskId: 'task-1',
      path: 'D:\\workspace\\src\\agent\\runtime.ts',
    });
  });

  it('拒绝未知 diffRef 格式', () => {
    expect(parseAiAedDiffRef('diff:runtime')).toBeNull();
    expect(parseAiAedDiffRef('aed-diff:missing-path')).toBeNull();
  });
});

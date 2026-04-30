import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAiAgentStore } from '@/store/aiAgent';

describe('aiAgent store step details', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('保存 step 的 Web Sources 摘要与工具结果，不保存网页全文', () => {
    const store = useAiAgentStore();

    store.setStepWebSources('run-1', 'step-1', [{
      id: 'web-source-1',
      title: 'Tauri Docs',
      url: 'https://tauri.app/start/',
      sourceType: 'docs',
      status: 'fetched',
      queryPreview: 'Tauri docs',
      fetchedAt: '2026-04-29T10:00:00.000Z',
      textRef: 'web-text:abc',
      excerpt: '短摘要',
    }]);
    store.appendStepToolResults('run-1', 'step-1', [{
      id: 'tool-result-1',
      runId: 'run-1',
      stepId: 'step-1',
      toolName: 'web_fetch',
      status: 'succeeded',
      summary: '读取 1 个网页正文引用',
      startedAt: '2026-04-29T10:00:00.000Z',
      endedAt: '2026-04-29T10:00:01.000Z',
      outputRef: 'web-text:abc',
    }]);

    const detail = store.getStepDetail('run-1', 'step-1');

    expect(detail?.webSources[0]?.textRef).toBe('web-text:abc');
    expect(detail?.webSources[0]?.excerpt).toBe('短摘要');
    expect(detail?.toolResults[0]?.outputRef).toBe('web-text:abc');
    expect(JSON.stringify(detail)).not.toContain('<html');
  });

  it('保存 patch summary 统计与 ref，不保存完整 diff', () => {
    const store = useAiAgentStore();

    store.appendPatchSummary({
      id: 'patch-summary-1',
      runId: 'run-1',
      stepId: 'step-1',
      totalAdditions: 3,
      totalDeletions: 1,
      patchRef: 'patch:run-1:step-1',
      appliedAt: '2026-04-29T10:00:00.000Z',
      files: [{
        path: 'src/agent/runtime.ts',
        status: 'modified',
        additions: 3,
        deletions: 1,
        diffRef: 'diff:runtime',
        rollbackRef: 'rollback:runtime',
      }],
    });

    const summaries = store.getPatchSummaries('run-1');

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.files[0]?.diffRef).toBe('diff:runtime');
    expect(JSON.stringify(summaries)).not.toContain("- const mode = 'chat'");
  });
});

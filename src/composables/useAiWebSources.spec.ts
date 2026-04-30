import { describe, expect, it, vi, beforeEach } from 'vitest';

import { useAiWebSources } from '@/composables/useAiWebSources';
import type { IAiTaskPlanStep, IAiWebFetchResult, IAiWebSearchResult } from '@/types/ai';

const aiServiceMock = vi.hoisted(() => {
  const webSearch = vi.fn();
  const webFetch = vi.fn();

  return {
    webSearch,
    webFetch,
    reset(): void {
      webSearch.mockReset();
      webFetch.mockReset();
    },
  };
});

vi.mock('@/services/modules/ai', () => ({
  aiService: {
    webSearch: aiServiceMock.webSearch,
    webFetch: aiServiceMock.webFetch,
  },
}));

const searchResult: IAiWebSearchResult = {
  title: 'Tauri Docs',
  url: 'https://tauri.app/start/',
  snippet: 'Tauri official docs',
  sourceType: 'docs',
  fetchedAt: '2026-04-29T10:00:00.000Z',
};

const fetchedSource: IAiWebFetchResult = {
  url: searchResult.url,
  title: searchResult.title,
  textRef: 'web-text:abc',
  excerpt: 'Fetched docs excerpt',
  bytes: 128,
  fetchedAt: '2026-04-29T10:01:00.000Z',
  truncated: false,
};

const createStep = (tools: IAiTaskPlanStep['tools']): IAiTaskPlanStep => ({
  id: 'plan-step-web',
  index: 0,
  title: '检索 Tauri 文档',
  goal: '查找 Tauri capability 官方文档',
  kind: 'search',
  status: 'running',
  expectedOutput: '官方文档来源',
  tools,
  requiresUserApproval: false,
  riskLevel: 'medium',
});
describe('useAiWebSources', () => {
  beforeEach(() => {
    aiServiceMock.reset();
  });

  it('搜索后只保存来源摘要与 ref 元数据', async () => {
    aiServiceMock.webSearch.mockResolvedValueOnce({
      results: [searchResult],
    });

    const webSources = useAiWebSources();
    const sources = await webSources.search(
      {
        query: 'Tauri capability docs',
        intent: 'official-docs',
        maxResults: 5,
        recency: 'any',
      },
      {
        stepId: 'step-search',
        stepTitle: '检索官方文档',
      },
    );

    expect(aiServiceMock.webSearch).toHaveBeenCalledWith({
      query: 'Tauri capability docs',
      intent: 'official-docs',
      maxResults: 5,
      recency: 'any',
    });
    expect(sources).toHaveLength(1);
    expect(webSources.sources.value[0]?.result.url).toBe(searchResult.url);
    expect(webSources.sources.value[0]?.stepId).toBe('step-search');
    expect(webSources.sources.value[0]?.stepTitle).toBe('检索官方文档');
    expect(webSources.activity.value).toBeNull();
  });

  it('读取网页后保存 textRef 和摘要，不保存网页全文', async () => {
    aiServiceMock.webSearch.mockResolvedValueOnce({
      results: [searchResult],
    });
    aiServiceMock.webFetch.mockResolvedValueOnce({
      source: fetchedSource,
    });

    const webSources = useAiWebSources();
    await webSources.search({
      query: 'Tauri docs',
      intent: 'official-docs',
      maxResults: 5,
    });

    const sourceId = webSources.sources.value[0]?.id;
    expect(sourceId).toBeTruthy();

    if (!sourceId) {
      throw new Error('sourceId should exist');
    }

    const fetched = await webSources.fetchSource(sourceId);

    expect(aiServiceMock.webFetch).toHaveBeenCalledWith({
      url: searchResult.url,
      reason: `读取搜索结果：${searchResult.title}`,
      maxBytes: 128 * 1024,
    });
    expect(fetched.status).toBe('fetched');
    expect(fetched.fetchedSource?.textRef).toBe('web-text:abc');
    expect(fetched.fetchedSource?.excerpt).toBe('Fetched docs excerpt');
  });

  it('搜索失败时保留失败活动和可见错误', async () => {
    aiServiceMock.webSearch.mockRejectedValueOnce(new Error('AI_AGENT_NETWORK_NOT_ALLOWED'));

    const webSources = useAiWebSources();

    await expect(webSources.search({
      query: 'Tauri docs',
      intent: 'official-docs',
      maxResults: 5,
    })).rejects.toThrow('AI_AGENT_NETWORK_NOT_ALLOWED');

    expect(webSources.errorMessage.value).toBe('AI_AGENT_NETWORK_NOT_ALLOWED');
    expect(webSources.activity.value?.state).toBe('failed');
  });

  it('按 step 工具声明自动执行 web_search 与 web_fetch', async () => {
    aiServiceMock.webSearch.mockResolvedValueOnce({
      results: [searchResult],
    });
    aiServiceMock.webFetch.mockResolvedValueOnce({
      source: fetchedSource,
    });

    const webSources = useAiWebSources();
    const step = createStep(['web_search', 'web_fetch']);
    const sources = await webSources.runStepWebTools(step);

    expect(aiServiceMock.webSearch).toHaveBeenCalledWith({
      query: step.goal,
      intent: 'general',
      maxResults: 5,
      recency: 'any',
    });
    expect(aiServiceMock.webFetch).toHaveBeenCalledWith({
      url: searchResult.url,
      reason: `读取搜索结果：${searchResult.title}`,
      maxBytes: 128 * 1024,
    });
    expect(sources[0]?.stepId).toBe(step.id);
    expect(webSources.hasCompletedWebToolsForStep(step)).toBe(true);
    expect(webSources.shouldRunWebToolsForStep(step)).toBe(false);
  });});

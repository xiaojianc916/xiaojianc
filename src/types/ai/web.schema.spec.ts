import { describe, expect, it } from 'vitest';

import {
  aiWebFetchInputSchema,
  aiWebSearchInputSchema,
  aiWebSearchPayloadSchema,
} from '@/types/ai/web.schema';

describe('AI web schema', () => {
  it('校验 web_search 输入和最多 8 条结果', () => {
    const input = aiWebSearchInputSchema.parse({
      query: 'Tauri capability 官方文档',
      intent: 'official-docs',
      maxResults: 8,
      recency: 'year',
    });

    expect(input.maxResults).toBe(8);

    expect(() =>
      aiWebSearchInputSchema.parse({
        query: 'Tauri',
        intent: 'official-docs',
        maxResults: 9,
      }),
    ).toThrow();

    expect(() =>
      aiWebSearchPayloadSchema.parse({
        results: Array.from({ length: 9 }, (_, index) => ({
          title: `结果 ${index}`,
          url: `https://example.com/${index}`,
          snippet: '',
          sourceType: 'unknown',
          fetchedAt: '2026-04-29T10:00:00.000Z',
        })),
      }),
    ).toThrow();
  });

  it('web_fetch 只接受公网 http/https URL', () => {
    expect(() =>
      aiWebFetchInputSchema.parse({
        url: 'https://docs.rs/reqwest/latest/reqwest/',
        reason: '读取官方文档',
        maxBytes: 512 * 1024,
      }),
    ).not.toThrow();

    for (const url of [
      'file:///C:/secret.txt',
      'http://localhost:1420',
      'http://127.0.0.1:1420',
      'http://192.168.1.10',
      'http://10.0.0.2',
      'http://172.16.0.2',
    ]) {
      expect(() =>
        aiWebFetchInputSchema.parse({
          url,
          reason: '应被拒绝',
          maxBytes: 1024,
        }),
      ).toThrow();
    }
  });
});

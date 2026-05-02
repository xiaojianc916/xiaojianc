import { buildAgentActivitiesFromSidecarState } from '@/utils/agent-activity';
import { describe, expect, it } from 'vitest';

describe('agent-activity', () => {
  it('把 sidecar 工具状态投影成 AG-UI 风格活动树', () => {
    const activities = buildAgentActivitiesFromSidecarState({
      runId: 'assistant-1',
      rootTitle: '联网搜索「伊朗 核设施」',
      status: 'running',
      activityTrail: [
        '正在核对最近公开信息',
      ],
      toolCalls: [
        {
          id: 'tool-search-1',
          name: 'tavily_search',
          status: 'running',
          summary: 'Iran Update Special Report',
          targetPreview: '伊朗 核设施 战争 2026年最新',
          detailItems: [
            '平台：Tavily',
            '查询：伊朗 核设施 战争 2026年最新',
            '站点：understandingwar.org',
          ],
        },
      ],
    });

    expect(activities[0]).toMatchObject({
      id: 'assistant-1:activity-root',
      kind: 'run',
      status: 'running',
      title: '联网搜索「伊朗 核设施」',
    });
    expect(activities[1]).toMatchObject({
      kind: 'reasoning_summary',
      parentId: 'assistant-1:activity-root',
      title: '正在核对最近公开信息',
    });
    expect(activities[2]).toMatchObject({
      kind: 'search',
      status: 'running',
      title: '联网搜索',
      description: '伊朗 核设施 战争 2026年最新',
      details: expect.arrayContaining([
        expect.objectContaining({
          label: '查询',
          value: '伊朗 核设施 战争 2026年最新',
        }),
        expect.objectContaining({
          label: '站点',
          value: 'understandingwar.org',
        }),
      ]),
      tool: {
        callId: 'tool-search-1',
        name: 'tavily_search',
      },
    });
  });

  it('不会把工具 SDK 名称当作产品标题', () => {
    const activities = buildAgentActivitiesFromSidecarState({
      runId: 'assistant-2',
      rootTitle: '读取文件',
      status: 'success',
      toolCalls: [
        {
          id: 'tool-read-1',
          name: 'read_media_file',
          status: 'succeeded',
          summary: 'D:/repo/assets/news.png',
          targetPreview: 'D:/repo/assets/news.png',
          detailItems: [
            '文件：D:/repo/assets/news.png',
          ],
        },
      ],
    });

    expect(activities[1]).toMatchObject({
      title: '查看媒体文件',
      description: 'D:/repo/assets/news.png',
    });
    expect(activities.map((activity) => activity.title).join('\n')).not.toContain('read_media_file');
  });
});

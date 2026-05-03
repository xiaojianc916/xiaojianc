import { describe, expect, it } from 'vitest';

import type { TAgentUiEvent } from '@/types/agent-sidecar';
import type { IAiNarratorFacts, IAiToolCall } from '@/types/ai';
import {
    buildActivityNarrationCandidate,
    shouldNarrateActivity,
} from '@/utils/activity-note-narrator';

const createToolCall = (overrides: Partial<IAiToolCall> = {}): IAiToolCall => ({
    id: 'tool-1',
    name: 'read_project_file',
    status: 'succeeded',
    summary: '已读取 app.ts',
    ...overrides,
});

const createFacts = (overrides: Partial<IAiNarratorFacts> = {}): IAiNarratorFacts => ({
    userGoal: '修复 app.ts',
    trigger: 'context_checked',
    recentActions: ['查看目录 src'],
    changedFiles: [],
    readFiles: [],
    previousNarrations: [],
    ...overrides,
});

const buildCandidate = (params: {
    userGoal?: string;
    events: TAgentUiEvent[];
    toolCalls: IAiToolCall[];
}) => buildActivityNarrationCandidate({
    userGoal: params.userGoal ?? '修复 narrator activity feed',
    events: params.events,
    toolCalls: params.toolCalls,
    previousNarrations: [],
});

describe('activity-note-narrator', () => {
    it('把 Tavily 搜索结果归为 web_search_done', () => {
        const candidate = buildCandidate({
            events: [
                {
                    type: 'tool_result',
                    toolName: 'tavily_search',
                    output: {
                        query: 'Arkloop activity tree',
                        resultCount: 5,
                    },
                },
            ],
            toolCalls: [
                createToolCall({
                    id: 'tool-web',
                    name: 'tavily_search',
                    summary: '联网搜索 “Arkloop activity tree”，5 个结果',
                    targetPreview: 'Arkloop activity tree',
                    detailItems: ['平台：Tavily', '查询：Arkloop activity tree', '结果：5 个'],
                }),
            ],
        });

        expect(candidate?.trigger).toBe('web_search_done');
        expect(candidate?.facts.searchSummary).toEqual({
            query: 'Arkloop activity tree',
            resultCount: 5,
        });
    });

    it('单次文件读取不触发 narrator，读完一批文件才提升为 files_read', () => {
        const singleRead = buildCandidate({
            events: [
                {
                    type: 'tool_result',
                    toolName: 'read_project_file',
                    output: { path: 'src/app.ts:1-40' },
                },
            ],
            toolCalls: [
                createToolCall({
                    id: 'tool-read-1',
                    name: 'read_project_file',
                    targetPreview: 'src/app.ts:1-40',
                    summary: '已读取 app.ts',
                }),
            ],
        });

        expect(singleRead).toBeNull();

        const batchedRead = buildCandidate({
            events: [
                {
                    type: 'tool_result',
                    toolName: 'read_project_file',
                    output: { path: 'src/useAiAssistant.ts:1-80' },
                },
            ],
            toolCalls: [
                createToolCall({
                    id: 'tool-read-1',
                    name: 'read_project_file',
                    targetPreview: 'src/app.ts:1-40',
                    summary: '已读取 app.ts',
                }),
                createToolCall({
                    id: 'tool-read-2',
                    name: 'read_project_file',
                    targetPreview: 'src/useAiAssistant.ts:1-80',
                    summary: '已读取 useAiAssistant.ts',
                }),
            ],
        });

        expect(batchedRead?.trigger).toBe('files_read');
        expect(batchedRead?.relatedActionIds).toEqual(['tool-read-1', 'tool-read-2']);
    });

    it('在验证命令刚开始时产出 verification_started', () => {
        const candidate = buildCandidate({
            events: [
                {
                    type: 'tool_start',
                    toolName: 'run_shell_command',
                    input: { command: 'pnpm vitest run src/composables/useAiAssistant.spec.ts' },
                },
            ],
            toolCalls: [
                createToolCall({
                    id: 'tool-verify',
                    name: 'run_shell_command',
                    status: 'running',
                    summary: 'pnpm vitest run src/composables/useAiAssistant.spec.ts',
                    targetPreview: 'pnpm vitest run src/composables/useAiAssistant.spec.ts',
                }),
            ],
        });

        expect(candidate?.trigger).toBe('verification_started');
    });

    it('默认抑制普通 time_checked，只有时间敏感任务才放行', () => {
        expect(shouldNarrateActivity({
            trigger: 'time_checked',
            facts: createFacts({
                trigger: 'time_checked',
                currentFinding: '获取当前时间 Asia/Shanghai，21:18',
            }),
            hasImportantFact: true,
            lastNarrationAt: 0,
            narrationCount: 0,
        })).toBe(false);

        expect(shouldNarrateActivity({
            trigger: 'time_checked',
            facts: createFacts({
                userGoal: '看下今天的日志是不是最新的',
                trigger: 'time_checked',
                currentFinding: '获取当前时间 Asia/Shanghai，21:18',
            }),
            hasImportantFact: true,
            lastNarrationAt: 0,
            narrationCount: 0,
        })).toBe(true);
    });

    it('默认抑制平淡的 git_checked，但 dirty worktree 会放行', () => {
        expect(shouldNarrateActivity({
            trigger: 'git_checked',
            facts: createFacts({
                trigger: 'git_checked',
                currentFinding: '查看当前分支 cleanup/activity-feed',
                recentActions: ['查看当前分支 cleanup/activity-feed'],
            }),
            hasImportantFact: true,
            lastNarrationAt: 0,
            narrationCount: 0,
        })).toBe(false);

        expect(shouldNarrateActivity({
            trigger: 'git_checked',
            facts: createFacts({
                trigger: 'git_checked',
                currentFinding: '查看 Git 状态，3 个变更',
                recentActions: ['查看 Git 状态，3 个变更'],
            }),
            hasImportantFact: true,
            lastNarrationAt: 0,
            narrationCount: 0,
        })).toBe(true);
    });
});
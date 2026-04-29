import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAiConversationStore } from '@/store/aiConversation';
import { useAiEditStore } from '@/store/aiEdit';

import { useAiRevert } from './useAiRevert';

const tauriServiceMock = vi.hoisted(() => ({
    aiEditGetAuthLevel: vi.fn(),
    aiEditSetAuthLevel: vi.fn(),
    aiEditGetDiff: vi.fn(),
    aiEditListTimeline: vi.fn(),
    aiEditRevertFile: vi.fn(),
    aiEditRevertHunk: vi.fn(),
    aiEditRevertTask: vi.fn(),
    aiEditRestoreSnapshot: vi.fn(),
    aiEditUndoOperation: vi.fn(),
}));

vi.mock('@/services/tauri', () => ({
    tauriService: tauriServiceMock,
}));

describe('useAiRevert', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();

        const conversationStore = useAiConversationStore();
        conversationStore.$patch({
            activeThreadId: 'task-1',
            threads: [
                {
                    id: 'task-1',
                    title: '测试任务',
                    updatedAt: '2026-04-28T10:00:00.000Z',
                    createdAt: '2026-04-28T10:00:00.000Z',
                    messages: [],
                },
            ],
        });
    });

    it('restoreSnapshot 调用 AED 恢复接口并刷新时间线', async () => {
        tauriServiceMock.aiEditRestoreSnapshot.mockResolvedValueOnce({
            snapshotId: 'snapshot-1',
            restoredFiles: ['src/main.ts'],
            preRevertSnapshot: {
                id: 'snapshot-pre-revert',
                scope: 'pre-revert',
                taskId: 'task-1',
                createdAt: '2026-04-28T10:00:00.000Z',
                label: '恢复前快照',
                fileRefs: ['src/main.ts'],
                storageKey: 'snapshots/pre-revert.json',
                sizeBytes: 64,
            },
            restoredSnapshot: {
                id: 'snapshot-revert',
                scope: 'revert',
                taskId: 'task-1',
                createdAt: '2026-04-28T10:00:01.000Z',
                label: '恢复到快照',
                fileRefs: ['src/main.ts'],
                storageKey: 'snapshots/revert.json',
                sizeBytes: 64,
            },
        });
        tauriServiceMock.aiEditListTimeline.mockResolvedValueOnce({ entries: [] });

        const revert = useAiRevert();
        const result = await revert.restoreSnapshot('snapshot-1');

        expect(result.status).toBe('success');
        expect(revert.canRestoreSnapshot.value).toBe(true);
        expect(tauriServiceMock.aiEditRestoreSnapshot).toHaveBeenCalledWith({
            snapshotId: 'snapshot-1',
        });
        expect(tauriServiceMock.aiEditListTimeline).toHaveBeenCalledWith({ taskId: 'task-1' });
    });

    it('undoOperation 调用 AED 撤销接口并刷新时间线', async () => {
        tauriServiceMock.aiEditUndoOperation.mockResolvedValueOnce({
            operationId: 'operation-1',
            restoredFiles: ['src/main.ts'],
            preRevertSnapshot: {
                id: 'snapshot-pre-revert',
                scope: 'pre-revert',
                taskId: 'task-1',
                createdAt: '2026-04-28T10:00:00.000Z',
                label: '撤销前快照',
                fileRefs: ['src/main.ts'],
                storageKey: 'snapshots/pre-revert.json',
                sizeBytes: 64,
            },
            restoredSnapshot: {
                id: 'snapshot-revert',
                scope: 'revert',
                taskId: 'task-1',
                createdAt: '2026-04-28T10:00:01.000Z',
                label: '撤销编辑',
                fileRefs: ['src/main.ts'],
                storageKey: 'snapshots/revert.json',
                sizeBytes: 64,
            },
        });
        tauriServiceMock.aiEditListTimeline.mockResolvedValueOnce({ entries: [] });

        const revert = useAiRevert();
        const result = await revert.undoOperation('operation-1');

        expect(result.status).toBe('success');
        expect(revert.canUndo.value).toBe(true);
        expect(tauriServiceMock.aiEditUndoOperation).toHaveBeenCalledWith({
            operationId: 'operation-1',
        });
        expect(tauriServiceMock.aiEditListTimeline).toHaveBeenCalledWith({ taskId: 'task-1' });
    });

    it('revertTask 调用 AED 任务回滚接口并刷新时间线', async () => {
        tauriServiceMock.aiEditRevertTask.mockResolvedValueOnce({
            taskId: 'task-1',
            revertedOperationIds: ['operation-2', 'operation-1'],
            restoredFiles: ['src/main.ts', 'src/lib.ts'],
            preRevertSnapshots: [
                {
                    id: 'snapshot-pre-revert-1',
                    scope: 'pre-revert',
                    taskId: 'task-1',
                    createdAt: '2026-04-28T10:00:00.000Z',
                    label: '撤销前快照 1',
                    fileRefs: ['src/main.ts'],
                    storageKey: 'snapshots/pre-revert-1.json',
                    sizeBytes: 64,
                },
            ],
            restoredSnapshots: [
                {
                    id: 'snapshot-revert-1',
                    scope: 'revert',
                    taskId: 'task-1',
                    createdAt: '2026-04-28T10:00:01.000Z',
                    label: '撤销后快照 1',
                    fileRefs: ['src/main.ts'],
                    storageKey: 'snapshots/revert-1.json',
                    sizeBytes: 64,
                },
            ],
        });
        tauriServiceMock.aiEditListTimeline.mockResolvedValueOnce({ entries: [] });

        const revert = useAiRevert();
        const result = await revert.revertTask('task-1');

        expect(result.status).toBe('success');
        expect(tauriServiceMock.aiEditRevertTask).toHaveBeenCalledWith({
            taskId: 'task-1',
        });
        expect(tauriServiceMock.aiEditListTimeline).toHaveBeenCalledWith({ taskId: 'task-1' });
    });

    it('revertFile 调用 AED 单文件回滚接口并刷新时间线', async () => {
        tauriServiceMock.aiEditRevertFile.mockResolvedValueOnce({
            taskId: 'task-1',
            path: 'src/main.ts',
            operationId: 'operation-3',
            restoredFiles: ['src/main.ts'],
            preRevertSnapshot: {
                id: 'snapshot-pre-revert-file',
                scope: 'pre-revert',
                taskId: 'task-1',
                createdAt: '2026-04-28T10:00:00.000Z',
                label: '文件回滚前快照',
                fileRefs: ['src/main.ts'],
                storageKey: 'snapshots/pre-revert-file.json',
                sizeBytes: 64,
            },
            restoredSnapshot: {
                id: 'snapshot-revert-file',
                scope: 'revert',
                taskId: 'task-1',
                createdAt: '2026-04-28T10:00:01.000Z',
                label: '文件回滚后快照',
                fileRefs: ['src/main.ts'],
                storageKey: 'snapshots/revert-file.json',
                sizeBytes: 64,
            },
        });
        tauriServiceMock.aiEditListTimeline.mockResolvedValueOnce({ entries: [] });

        const revert = useAiRevert();
        const result = await revert.revertFile('task-1', 'src/main.ts');

        expect(result.status).toBe('success');
        expect(tauriServiceMock.aiEditRevertFile).toHaveBeenCalledWith({
            taskId: 'task-1',
            path: 'src/main.ts',
        });
        expect(tauriServiceMock.aiEditListTimeline).toHaveBeenCalledWith({ taskId: 'task-1' });
    });

    it('getDiff 调用 AED diff 预览接口', async () => {
        tauriServiceMock.aiEditGetDiff.mockResolvedValueOnce({
            taskId: 'task-1',
            path: 'src/main.ts',
            operationId: 'operation-4',
            kind: 'modify',
            additions: 2,
            deletions: 1,
            hunks: [
                {
                    hunkIndex: 0,
                    oldStart: 3,
                    oldLines: 1,
                    newStart: 3,
                    newLines: 2,
                    lines: ['-echo old', '+echo new', '+echo newer'],
                },
            ],
        });

        const revert = useAiRevert();
        const result = await revert.getDiff('task-1', 'src/main.ts');

        expect(result.status).toBe('success');
        expect(tauriServiceMock.aiEditGetDiff).toHaveBeenCalledWith({
            taskId: 'task-1',
            path: 'src/main.ts',
        });
    });

    it('revertHunk 调用 AED hunk 回滚接口并刷新时间线', async () => {
        tauriServiceMock.aiEditRevertHunk.mockResolvedValueOnce({
            taskId: 'task-1',
            path: 'src/main.ts',
            operationId: 'operation-4',
            hunkIndex: 0,
            restoredFiles: ['src/main.ts'],
            preRevertSnapshot: {
                id: 'snapshot-pre-revert-hunk',
                scope: 'pre-revert',
                taskId: 'task-1',
                createdAt: '2026-04-28T10:00:00.000Z',
                label: 'hunk 回滚前快照',
                fileRefs: ['src/main.ts'],
                storageKey: 'snapshots/pre-revert-hunk.json',
                sizeBytes: 64,
            },
            restoredSnapshot: {
                id: 'snapshot-revert-hunk',
                scope: 'revert',
                taskId: 'task-1',
                createdAt: '2026-04-28T10:00:01.000Z',
                label: 'hunk 回滚后快照',
                fileRefs: ['src/main.ts'],
                storageKey: 'snapshots/revert-hunk.json',
                sizeBytes: 64,
            },
        });
        tauriServiceMock.aiEditListTimeline.mockResolvedValueOnce({ entries: [] });

        const revert = useAiRevert();
        const result = await revert.revertHunk('task-1', 'src/main.ts', 0);

        expect(result.status).toBe('success');
        expect(tauriServiceMock.aiEditRevertHunk).toHaveBeenCalledWith({
            taskId: 'task-1',
            path: 'src/main.ts',
            hunkIndex: 0,
        });
        expect(tauriServiceMock.aiEditListTimeline).toHaveBeenCalledWith({ taskId: 'task-1' });
    });

    it('undoLastEdit 会回滚当前任务最近一条可撤销编辑', async () => {
        const store = useAiEditStore();
        store.timelineEntries = [
            {
                type: 'operation',
                data: {
                    id: 'operation-2',
                    taskId: 'task-1',
                    turnId: 'turn-1',
                    kind: 'modify',
                    path: 'src/main.ts',
                    sourceSnapshotId: 'snapshot-1',
                    beforeHash: 'before',
                    afterHash: 'after',
                    bytesBefore: 12,
                    bytesAfter: 18,
                    appliedAt: '2026-04-28T10:01:00.000Z',
                    reason: '补当前任务回滚入口',
                    toolCallId: null,
                },
            },
        ];
        tauriServiceMock.aiEditUndoOperation.mockResolvedValueOnce({
            operationId: 'operation-2',
            restoredFiles: ['src/main.ts'],
            preRevertSnapshot: {
                id: 'snapshot-pre-revert',
                scope: 'pre-revert',
                taskId: 'task-1',
                createdAt: '2026-04-28T10:02:00.000Z',
                label: '撤销前快照',
                fileRefs: ['src/main.ts'],
                storageKey: 'snapshots/pre-revert.json',
                sizeBytes: 64,
            },
            restoredSnapshot: {
                id: 'snapshot-revert',
                scope: 'revert',
                taskId: 'task-1',
                createdAt: '2026-04-28T10:02:01.000Z',
                label: '撤销编辑',
                fileRefs: ['src/main.ts'],
                storageKey: 'snapshots/revert.json',
                sizeBytes: 64,
            },
        });
        tauriServiceMock.aiEditListTimeline.mockResolvedValueOnce({ entries: [] });

        const revert = useAiRevert();
        const result = await revert.undoLastEdit();

        expect(result.status).toBe('success');
        expect(tauriServiceMock.aiEditUndoOperation).toHaveBeenCalledWith({
            operationId: 'operation-2',
        });
    });
});
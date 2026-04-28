import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAiConversationStore } from '@/store/aiConversation';
import { useAiEditStore } from '@/store/aiEdit';

import { useAiEditTimeline } from './useAiEditTimeline';

const tauriServiceMock = vi.hoisted(() => ({
    aiEditGetAuthLevel: vi.fn(),
    aiEditSetAuthLevel: vi.fn(),
    aiEditListTimeline: vi.fn(),
    aiEditCreateSnapshot: vi.fn(),
    aiEditRestoreSnapshot: vi.fn(),
    aiEditUndoOperation: vi.fn(),
    aiEditRevertTask: vi.fn(),
}));

vi.mock('@/services/tauri', () => ({
    tauriService: tauriServiceMock,
}));

describe('useAiEditTimeline', () => {
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

    it('createManualSnapshot 会基于当前任务文件生成手动快照并刷新时间线', async () => {
        const store = useAiEditStore();
        store.timelineEntries = [
            {
                type: 'operation',
                data: {
                    id: 'operation-1',
                    taskId: 'task-1',
                    turnId: 'turn-1',
                    kind: 'modify',
                    path: 'src/main.ts',
                    sourceSnapshotId: 'snapshot-pre-tool',
                    beforeHash: 'before',
                    afterHash: 'after',
                    bytesBefore: 12,
                    bytesAfter: 18,
                    appliedAt: '2026-04-28T10:01:00.000Z',
                    reason: '编辑文件',
                    toolCallId: null,
                },
            },
        ];
        tauriServiceMock.aiEditCreateSnapshot.mockResolvedValueOnce({
            snapshot: {
                id: 'snapshot-manual',
                scope: 'manual',
                taskId: 'task-1',
                createdAt: '2026-04-28T10:02:00.000Z',
                label: 'Pin checkpoint',
                fileRefs: ['src/main.ts'],
                storageKey: 'snapshots/snapshot-manual.json',
                sizeBytes: 32,
            },
        });
        tauriServiceMock.aiEditListTimeline.mockResolvedValueOnce({ entries: [] });

        const timeline = useAiEditTimeline();
        const snapshot = await timeline.createManualSnapshot('Pin checkpoint');

        expect(snapshot.scope).toBe('manual');
        expect(tauriServiceMock.aiEditCreateSnapshot).toHaveBeenCalledWith({
            taskId: 'task-1',
            label: 'Pin checkpoint',
            fileRefs: ['src/main.ts'],
        });
        expect(tauriServiceMock.aiEditListTimeline).toHaveBeenCalledWith({ taskId: 'task-1' });
    });
});
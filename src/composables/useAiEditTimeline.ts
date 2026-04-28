import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';

import { aiEditService } from '@/services/modules/ai-edit';
import { useAiConversationStore } from '@/store/aiConversation';
import { useAiEditStore } from '@/store/aiEdit';
import type {
    IAiEditCreateSnapshotPayload,
    IAiEditListTimelineRequest,
    IAiEditOperation,
    IAiEditTimelineEntry,
    IAiSnapshot,
} from '@/types/ai-edit';
import { AppError, isAppError } from '@/types/app-error';

const isOperationEntry = (
    entry: IAiEditTimelineEntry,
): entry is IAiEditTimelineEntry & { type: 'operation'; data: IAiEditOperation } =>
    entry.type === 'operation';

const isSnapshotEntry = (
    entry: IAiEditTimelineEntry,
): entry is IAiEditTimelineEntry & { type: 'snapshot'; data: IAiSnapshot } =>
    entry.type === 'snapshot';

export const useAiEditTimeline = () => {
    const conversationStore = useAiConversationStore();
    const store = useAiEditStore();
    const { timelineEntries, status, errorMessage } = storeToRefs(store);
    const isCreatingSnapshot = ref(false);
    const createSnapshotError = ref<AppError | null>(null);

    const activeTaskId = computed<string | null>(() => conversationStore.activeThreadId);
    const activeTaskEntries = computed<IAiEditTimelineEntry[]>(() => {
        const taskId = activeTaskId.value;
        if (!taskId) {
            return timelineEntries.value;
        }

        return timelineEntries.value.filter((entry) => entry.data.taskId === taskId);
    });
    const hasEntries = computed<boolean>(() => activeTaskEntries.value.length > 0);
    const latestOperation = computed<IAiEditOperation | null>(() => {
        const entry = activeTaskEntries.value.find(isOperationEntry);
        return entry?.data ?? null;
    });
    const latestUndoableOperation = computed<IAiEditOperation | null>(() => {
        const entry = activeTaskEntries.value.find(
            (
                item,
            ): item is IAiEditTimelineEntry & { type: 'operation'; data: IAiEditOperation } =>
                isOperationEntry(item) && Boolean(item.data.sourceSnapshotId),
        );
        return entry?.data ?? null;
    });
    const latestSnapshot = computed<IAiSnapshot | null>(() => {
        const entry = activeTaskEntries.value.find(isSnapshotEntry);
        return entry?.data ?? null;
    });
    const currentTaskId = computed<string | null>(() =>
        activeTaskId.value && activeTaskEntries.value.length > 0 ? activeTaskId.value : null,
    );
    const editedFileCount = computed<number>(() => {
        const fileSet = new Set(
            activeTaskEntries.value
                .filter(isOperationEntry)
                .map((entry) => entry.data.newPath ?? entry.data.path),
        );
        return fileSet.size;
    });
    const snapshotFileRefs = computed<string[]>(() => {
        const operationFiles = new Set(
            activeTaskEntries.value
                .filter(isOperationEntry)
                .map((entry) => (entry.data.newPath ?? entry.data.path).trim())
                .filter(Boolean),
        );
        if (operationFiles.size > 0) {
            return Array.from(operationFiles);
        }

        const snapshotFiles = new Set<string>();
        for (const entry of activeTaskEntries.value) {
            if (!isSnapshotEntry(entry)) {
                continue;
            }

            for (const fileRef of entry.data.fileRefs) {
                const trimmed = fileRef.trim();
                if (trimmed) {
                    snapshotFiles.add(trimmed);
                }
            }
        }

        return Array.from(snapshotFiles);
    });
    const canCreateManualSnapshot = computed<boolean>(() =>
        Boolean((currentTaskId.value ?? activeTaskId.value) && snapshotFileRefs.value.length > 0)
        && !isCreatingSnapshot.value,
    );

    const loadTimeline = (payload: IAiEditListTimelineRequest = {}): Promise<unknown> =>
        store.loadTimeline(payload);

    const normalizeSnapshotError = (value: unknown, action: string): AppError => {
        if (isAppError(value)) {
            return value;
        }

        if (value instanceof Error) {
            return new AppError({
                code: 'AI_EDIT_SNAPSHOT_FAILED',
                message: value.message,
                scope: 'ipc',
                traceId: `ai-edit-snapshot-${action}`,
                cause: value,
            });
        }

        return new AppError({
            code: 'AI_EDIT_SNAPSHOT_FAILED',
            message: '创建 AED checkpoint 失败。',
            scope: 'ipc',
            traceId: `ai-edit-snapshot-${action}`,
            cause: value,
        });
    };

    const createManualSnapshot = async (label?: string): Promise<IAiSnapshot> => {
        const taskId = currentTaskId.value ?? activeTaskId.value;
        if (!taskId) {
            const nextError = new AppError({
                code: 'AI_EDIT_SNAPSHOT_FAILED',
                message: '当前任务尚未生成 AED 记录，无法创建 checkpoint。',
                scope: 'ipc',
                traceId: 'ai-edit-snapshot-missing-task',
            });
            createSnapshotError.value = nextError;
            throw nextError;
        }

        if (snapshotFileRefs.value.length === 0) {
            const nextError = new AppError({
                code: 'AI_EDIT_SNAPSHOT_FAILED',
                message: '当前任务没有可写入 checkpoint 的文件。',
                scope: 'ipc',
                traceId: 'ai-edit-snapshot-empty-files',
            });
            createSnapshotError.value = nextError;
            throw nextError;
        }

        isCreatingSnapshot.value = true;
        createSnapshotError.value = null;

        try {
            const payload: IAiEditCreateSnapshotPayload = await aiEditService.createSnapshot({
                taskId,
                label: label?.trim() || null,
                fileRefs: snapshotFileRefs.value,
            });
            await store.loadTimeline({ taskId }).catch(() => undefined);
            return payload.snapshot;
        } catch (value) {
            const nextError = normalizeSnapshotError(value, 'create-manual');
            createSnapshotError.value = nextError;
            throw nextError;
        } finally {
            isCreatingSnapshot.value = false;
        }
    };

    return {
        activeTaskId,
        activeTaskEntries,
        canCreateManualSnapshot,
        currentTaskId,
        createManualSnapshot,
        createSnapshotError,
        editedFileCount,
        isCreatingSnapshot,
        timelineEntries,
        hasEntries,
        latestOperation,
        latestSnapshot,
        latestUndoableOperation,
        snapshotFileRefs,
        status,
        errorMessage,
        loadTimeline,
        clearTimeline: store.clearTimeline,
    };
};
import { aiEditService } from '@/services/modules/ai-edit';
import { useAiEditStore } from '@/store/aiEdit';
import type {
    IAiEditRestoreSnapshotPayload,
    IAiEditRevertTaskPayload,
    IAiEditUndoOperationPayload,
} from '@/types/ai-edit';
import { AppError, isAppError } from '@/types/app-error';
import { computed, ref } from 'vue';

import { useAiEditTimeline } from './useAiEditTimeline';

interface IAiRevertFailureResult {
    data: null;
    error: AppError;
    status: 'failed';
}

interface IAiRevertSuccessResult<TData> {
    data: TData;
    error: null;
    status: 'success';
}

type TAiRevertActionResult<TData> = IAiRevertFailureResult | IAiRevertSuccessResult<TData>;

const createUnavailableError = (action: string, message?: string): AppError =>
    new AppError({
        code: 'AI_EDIT_REVERT_NOT_READY',
        message: message ?? `AED 回滚能力尚未接入：${action}`,
        scope: 'ipc',
        traceId: `ai-edit-revert-${action}`,
    });

export const useAiRevert = () => {
    const store = useAiEditStore();
    const timeline = useAiEditTimeline();
    const isReverting = ref(false);
    const error = ref<AppError | null>(null);
    const canUndo = computed<boolean>(() => true);
    const canRestoreSnapshot = computed<boolean>(() => true);
    const latestUndoableOperation = computed(() => timeline.latestUndoableOperation.value);
    const latestSnapshot = computed(() => timeline.latestSnapshot.value);
    const currentTaskId = computed(() => timeline.currentTaskId.value);
    const canUndoLastEdit = computed<boolean>(() => Boolean(latestUndoableOperation.value?.id));
    const canRestoreLatestSnapshot = computed<boolean>(() => Boolean(latestSnapshot.value?.id));
    const canRevertTask = computed<boolean>(() => Boolean(currentTaskId.value));
    const isSupported = computed<boolean>(() =>
        canUndo.value || canRestoreSnapshot.value || canUndoLastEdit.value || canRevertTask.value,
    );
    const buildRefreshPayload = (): { taskId?: string } =>
        timeline.activeTaskId.value ? { taskId: timeline.activeTaskId.value } : {};

    const runUnavailableAction = async (
        action: string,
        message?: string,
    ): Promise<IAiRevertFailureResult> => {
        isReverting.value = true;
        const nextError = createUnavailableError(action, message);
        error.value = nextError;
        isReverting.value = false;
        return {
            data: null,
            error: nextError,
            status: 'failed',
        };
    };

    const normalizeError = (value: unknown, action: string): AppError => {
        if (isAppError(value)) {
            return value;
        }

        if (value instanceof Error) {
            return new AppError({
                code: 'AI_EDIT_RESTORE_FAILED',
                message: value.message,
                scope: 'ipc',
                traceId: `ai-edit-revert-${action}`,
                cause: value,
            });
        }

        return new AppError({
            code: 'AI_EDIT_RESTORE_FAILED',
            message: `AED 恢复失败：${action}`,
            scope: 'ipc',
            traceId: `ai-edit-revert-${action}`,
            cause: value,
        });
    };

    const restoreSnapshot = async (
        snapshotId: string,
    ): Promise<TAiRevertActionResult<IAiEditRestoreSnapshotPayload>> => {
        isReverting.value = true;
        error.value = null;

        try {
            const data = await aiEditService.restoreSnapshot({ snapshotId });
            await store.loadTimeline(buildRefreshPayload()).catch(() => undefined);
            return {
                data,
                error: null,
                status: 'success',
            };
        } catch (value) {
            const nextError = normalizeError(value, `restore-snapshot:${snapshotId}`);
            error.value = nextError;
            return {
                data: null,
                error: nextError,
                status: 'failed',
            };
        } finally {
            isReverting.value = false;
        }
    };

    const undoOperation = async (
        operationId: string,
    ): Promise<TAiRevertActionResult<IAiEditUndoOperationPayload>> => {
        isReverting.value = true;
        error.value = null;

        try {
            const data = await aiEditService.undoOperation({ operationId });
            await store.loadTimeline(buildRefreshPayload()).catch(() => undefined);
            return {
                data,
                error: null,
                status: 'success',
            };
        } catch (value) {
            const nextError = normalizeError(value, `undo-operation:${operationId}`);
            error.value = nextError;
            return {
                data: null,
                error: nextError,
                status: 'failed',
            };
        } finally {
            isReverting.value = false;
        }
    };

    const revertTask = async (
        taskId: string,
    ): Promise<TAiRevertActionResult<IAiEditRevertTaskPayload>> => {
        isReverting.value = true;
        error.value = null;

        try {
            const data = await aiEditService.revertTask({ taskId });
            await store.loadTimeline(buildRefreshPayload()).catch(() => undefined);
            return {
                data,
                error: null,
                status: 'success',
            };
        } catch (value) {
            const nextError = normalizeError(value, `revert-task:${taskId}`);
            error.value = nextError;
            return {
                data: null,
                error: nextError,
                status: 'failed',
            };
        } finally {
            isReverting.value = false;
        }
    };

    const undoLastEdit = (): Promise<IAiRevertFailureResult | IAiRevertSuccessResult<IAiEditUndoOperationPayload>> => {
        const operationId = latestUndoableOperation.value?.id;
        if (!operationId) {
            return runUnavailableAction('undo-last', '当前任务没有可撤销的 AED 编辑。');
        }

        return undoOperation(operationId);
    };

    const restoreLatestSnapshot = (): Promise<IAiRevertFailureResult | IAiRevertSuccessResult<IAiEditRestoreSnapshotPayload>> => {
        const snapshotId = latestSnapshot.value?.id;
        if (!snapshotId) {
            return runUnavailableAction('restore-latest-snapshot', '当前任务没有可恢复的 AED 快照。');
        }

        return restoreSnapshot(snapshotId);
    };

    const revertCurrentTask = (): Promise<IAiRevertFailureResult | IAiRevertSuccessResult<IAiEditRevertTaskPayload>> => {
        const taskId = currentTaskId.value;
        if (!taskId) {
            return runUnavailableAction('revert-current-task', '当前任务没有可回滚的 AED 记录。');
        }

        return revertTask(taskId);
    };

    return {
        isSupported,
        canUndo,
        canRestoreSnapshot,
        canRevertTask,
        canRestoreLatestSnapshot,
        canUndoLastEdit,
        currentTaskId,
        isReverting,
        error,
        latestSnapshot,
        latestUndoableOperation,
        restoreLatestSnapshot,
        revertCurrentTask,
        undoLastEdit,
        undoOperation,
        revertTask,
        restoreSnapshot,
    };
};
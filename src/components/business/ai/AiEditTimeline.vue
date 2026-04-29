<script setup lang="ts">
import { useAiEditTimeline } from '@/composables/useAiEditTimeline';
import { useAiRevert } from '@/composables/useAiRevert';
import type { IAiEditGetDiffPayload, IAiEditTimelineEntry } from '@/types/ai-edit';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import AiEditDiffPreview from './AiEditDiffPreview.vue';
import AiEditTimelineItem from './AiEditTimelineItem.vue';
import AiRevertConfirmDialog from './AiRevertConfirmDialog.vue';

const timeline = useAiEditTimeline();
const revert = useAiRevert();

const dialogOpen = ref(false);
const dialogTitle = ref('');
const dialogDescription = ref('');
const dialogConfirmText = ref('知道了');
const dialogMode = ref<'info' | 'restore' | 'task' | 'undo' | 'file'>('info');
const pendingRestoreSnapshotId = ref<string | null>(null);
const pendingTaskId = ref<string | null>(null);
const pendingUndoOperationId = ref<string | null>(null);
const pendingFileTaskId = ref<string | null>(null);
const pendingFilePath = ref<string | null>(null);
const activeDiffEntryId = ref<string | null>(null);
const diffPreview = ref<IAiEditGetDiffPayload | null>(null);
const isDiffLoading = ref(false);
const activeHunkIndex = ref<number | null>(null);
const snapshotFeedback = ref('');

let snapshotFeedbackTimer: number | null = null;

const setSnapshotFeedback = (message: string): void => {
    if (snapshotFeedbackTimer !== null) {
        window.clearTimeout(snapshotFeedbackTimer);
        snapshotFeedbackTimer = null;
    }

    snapshotFeedback.value = message;
    snapshotFeedbackTimer = window.setTimeout(() => {
        snapshotFeedback.value = '';
        snapshotFeedbackTimer = null;
    }, 2400);
};

const statusLabel = computed(() => {
    if (timeline.isCreatingSnapshot.value) {
        return '正在创建 AED checkpoint';
    }
    if (isDiffLoading.value) {
        return '正在生成 AED diff 预览';
    }
    if (snapshotFeedback.value) {
        return snapshotFeedback.value;
    }
    if (revert.isReverting.value) {
        return '正在执行 AED 回滚';
    }
    if (revert.error.value) {
        return revert.error.value.message;
    }
    if (timeline.status.value === 'loading') {
        return '正在读取 AED 时间线';
    }
    if (timeline.errorMessage.value) {
        return timeline.errorMessage.value;
    }
    if (timeline.currentTaskId.value) {
        return '当前任务内的快照与编辑按时间倒序展示。';
    }
    return '当前对话尚无 AED 编辑记录。';
});

const openNotReadyDialog = (entry: IAiEditTimelineEntry, action: 'undo' | 'restore'): void => {
    dialogMode.value = 'info';
    pendingRestoreSnapshotId.value = null;
    pendingTaskId.value = null;
    pendingUndoOperationId.value = null;
    pendingFileTaskId.value = null;
    pendingFilePath.value = null;
    dialogConfirmText.value = '知道了';
    dialogTitle.value = action === 'undo' ? '撤销接口即将接入' : '恢复接口即将接入';
    dialogDescription.value = entry.type === 'snapshot'
        ? `快照 ${entry.data.label} 的恢复入口已预留，下一步接入真实回滚命令。`
        : `文件 ${entry.data.path} 的 ${action === 'undo' ? '撤销' : '恢复'}入口已预留，下一步接入真实回滚命令。`;
    dialogOpen.value = true;
};

const openRestoreDialog = (entry: IAiEditTimelineEntry): void => {
    if (entry.type !== 'snapshot') {
        openNotReadyDialog(entry, 'restore');
        return;
    }

    dialogMode.value = 'restore';
    pendingRestoreSnapshotId.value = entry.data.id;
    pendingTaskId.value = null;
    pendingUndoOperationId.value = null;
    pendingFileTaskId.value = null;
    pendingFilePath.value = null;
    dialogConfirmText.value = '确认恢复';
    dialogTitle.value = '确认恢复到该快照';
    dialogDescription.value = `将把 ${entry.data.fileRefs.length} 个文件恢复到快照“${entry.data.label}”记录的内容，并生成 pre-revert / revert 时间线条目。`;
    dialogOpen.value = true;
};

const openUndoDialog = (entry: IAiEditTimelineEntry): void => {
    if (entry.type !== 'operation' || !entry.data.sourceSnapshotId) {
        openNotReadyDialog(entry, 'undo');
        return;
    }

    dialogMode.value = 'undo';
    pendingUndoOperationId.value = entry.data.id;
    pendingRestoreSnapshotId.value = null;
    pendingTaskId.value = null;
    pendingFileTaskId.value = null;
    pendingFilePath.value = null;
    dialogConfirmText.value = '确认撤销';
    dialogTitle.value = '确认撤销该编辑';
    dialogDescription.value = `将把文件“${entry.data.path}”恢复到这次 AED 编辑前的快照内容，并生成 pre-revert / revert 时间线条目。`;
    dialogOpen.value = true;
};

const openTaskRevertDialog = (): void => {
    if (!revert.currentTaskId.value) {
        dialogMode.value = 'info';
        dialogTitle.value = '当前任务暂无可回滚内容';
        dialogDescription.value = '只有在当前任务已经产生 AED 编辑或快照后，才能执行任务级回滚。';
        dialogConfirmText.value = '知道了';
        pendingTaskId.value = null;
        pendingRestoreSnapshotId.value = null;
        pendingUndoOperationId.value = null;
        dialogOpen.value = true;
        return;
    }

    dialogMode.value = 'task';
    pendingTaskId.value = revert.currentTaskId.value;
    pendingRestoreSnapshotId.value = null;
    pendingUndoOperationId.value = null;
    pendingFileTaskId.value = null;
    pendingFilePath.value = null;
    dialogConfirmText.value = '确认回滚';
    dialogTitle.value = '确认回滚当前任务';
    dialogDescription.value = `将把当前任务涉及的 AED 编辑恢复到 task-start / pre-tool 快照记录的状态，并生成 pre-revert / revert 时间线条目。`;
    dialogOpen.value = true;
};

const openFileRevertDialogFor = (taskId: string, path: string): void => {
    dialogMode.value = 'file';
    pendingFileTaskId.value = taskId;
    pendingFilePath.value = path;
    pendingRestoreSnapshotId.value = null;
    pendingTaskId.value = null;
    pendingUndoOperationId.value = null;
    dialogConfirmText.value = '确认回滚文件';
    dialogTitle.value = '确认按文件回滚';
    dialogDescription.value = `将把文件“${path}”恢复到当前任务最近一条有效 AED 编辑之前的状态，并生成 pre-revert / revert 时间线条目。`;
    dialogOpen.value = true;
};

const openFileRevertDialog = (entry: IAiEditTimelineEntry): void => {
    if (entry.type !== 'operation') {
        openNotReadyDialog(entry, 'undo');
        return;
    }

    openFileRevertDialogFor(entry.data.taskId, entry.data.newPath ?? entry.data.path);
};

const loadDiffPreview = async (taskId: string, path: string, entryId: string): Promise<void> => {
    isDiffLoading.value = true;
    const result = await revert.getDiff(taskId, path);
    if (activeDiffEntryId.value !== entryId) {
        isDiffLoading.value = false;
        return;
    }

    diffPreview.value = result.status === 'success' ? result.data : null;
    isDiffLoading.value = false;
};

const openDiffPreview = (entry: IAiEditTimelineEntry): void => {
    if (entry.type !== 'operation') {
        return;
    }

    const entryId = entry.data.id;
    if (activeDiffEntryId.value === entryId) {
        activeDiffEntryId.value = null;
        diffPreview.value = null;
        activeHunkIndex.value = null;
        return;
    }

    activeDiffEntryId.value = entryId;
    diffPreview.value = null;
    activeHunkIndex.value = null;
    void loadDiffPreview(entry.data.taskId, entry.data.newPath ?? entry.data.path, entryId);
};

const isDiffVisible = (entry: IAiEditTimelineEntry): boolean =>
    entry.type === 'operation' && activeDiffEntryId.value === entry.data.id;

const refreshActiveDiffPreview = async (): Promise<void> => {
    if (!diffPreview.value || !activeDiffEntryId.value) {
        return;
    }

    await loadDiffPreview(diffPreview.value.taskId, diffPreview.value.path, activeDiffEntryId.value);
};

const handlePreviewFileRevert = (): void => {
    if (!diffPreview.value) {
        return;
    }

    openFileRevertDialogFor(diffPreview.value.taskId, diffPreview.value.path);
};

const handleHunkRevert = async (hunkIndex: number): Promise<void> => {
    if (!diffPreview.value) {
        return;
    }

    activeHunkIndex.value = hunkIndex;
    const result = await revert.revertHunk(diffPreview.value.taskId, diffPreview.value.path, hunkIndex);
    activeHunkIndex.value = null;

    if (result.status === 'success') {
        await refreshActiveDiffPreview();
    }
};

const pinCheckpoint = async (): Promise<void> => {
    try {
        const snapshot = await timeline.createManualSnapshot('Pin checkpoint');
        setSnapshotFeedback(`已创建 checkpoint · ${snapshot.label}`);
    } catch (error) {
        setSnapshotFeedback(
            error instanceof Error && error.message.trim()
                ? error.message
                : '创建 checkpoint 失败。',
        );
    }
};

const handleDialogConfirm = async (): Promise<void> => {
    let result;
    if (dialogMode.value === 'restore' && pendingRestoreSnapshotId.value) {
        result = await revert.restoreSnapshot(pendingRestoreSnapshotId.value);
    } else if (dialogMode.value === 'task' && pendingTaskId.value) {
        result = await revert.revertTask(pendingTaskId.value);
    } else if (dialogMode.value === 'undo' && pendingUndoOperationId.value) {
        result = await revert.undoOperation(pendingUndoOperationId.value);
    } else if (dialogMode.value === 'file' && pendingFileTaskId.value && pendingFilePath.value) {
        result = await revert.revertFile(pendingFileTaskId.value, pendingFilePath.value);
    } else {
        dialogOpen.value = false;
        return;
    }

    if (result.status === 'success') {
        dialogOpen.value = false;
        pendingRestoreSnapshotId.value = null;
        pendingTaskId.value = null;
        pendingUndoOperationId.value = null;
        pendingFileTaskId.value = null;
        pendingFilePath.value = null;
        if (dialogMode.value === 'file') {
            await refreshActiveDiffPreview();
        }
        return;
    }

    dialogMode.value = 'info';
    dialogConfirmText.value = '知道了';
    dialogTitle.value = '恢复失败';
    dialogDescription.value = result.error.message;
};

onMounted(() => {
    timeline.loadTimeline(timeline.activeTaskId.value ? { taskId: timeline.activeTaskId.value } : {}).catch(() => undefined);
});

watch(
    () => timeline.activeTaskId.value,
    (taskId) => {
        activeDiffEntryId.value = null;
        diffPreview.value = null;
        activeHunkIndex.value = null;
        void timeline.loadTimeline(taskId ? { taskId } : {}).catch(() => undefined);
    },
);

onBeforeUnmount(() => {
    if (snapshotFeedbackTimer !== null) {
        window.clearTimeout(snapshotFeedbackTimer);
    }
});
</script>

<template>
    <section class="ai-edit-timeline" aria-label="AED 时间线">
        <header class="ai-edit-timeline__header">
            <div>
                <strong>AED 时间线</strong>
                <p>{{ statusLabel }}</p>
            </div>
            <div class="ai-edit-timeline__header-actions">
                <button
type="button" class="ai-edit-timeline__pin-button"
                    :disabled="!timeline.canCreateManualSnapshot.value" @click="pinCheckpoint">
                    {{ timeline.isCreatingSnapshot.value ? 'Pinning…' : 'Pin checkpoint' }}
                </button>
                <button
type="button" class="ai-edit-timeline__revert-button" :disabled="!revert.canRevertTask.value"
                    @click="openTaskRevertDialog">
                    回滚当前任务
                </button>
                <span class="ai-edit-timeline__count">{{ timeline.activeTaskEntries.value.length }}</span>
            </div>
        </header>

        <div v-if="timeline.hasEntries.value" class="ai-edit-timeline__list">
            <div v-for="entry in timeline.activeTaskEntries.value" :key="entry.data.id" class="ai-edit-timeline__entry">
                <AiEditTimelineItem
:entry="entry" :can-undo="revert.canUndo.value"
                    :can-restore="revert.canRestoreSnapshot.value" :can-revert-file="revert.canRevertTask.value"
                    @undo="openUndoDialog($event)" @restore="openRestoreDialog($event)"
                    @revert-file="openFileRevertDialog($event)" @preview-diff="openDiffPreview($event)" />
                <AiEditDiffPreview
v-if="isDiffVisible(entry)" :diff="diffPreview" :is-loading="isDiffLoading"
                    :is-reverting="revert.isReverting.value" :active-hunk-index="activeHunkIndex"
                    :can-revert-file="revert.canRevertTask.value"
                    :can-revert-hunk="Boolean(diffPreview && diffPreview.kind === 'modify')"
                    @revert-file="handlePreviewFileRevert" @revert-hunk="handleHunkRevert" />
            </div>
        </div>

        <div v-else class="ai-edit-timeline__empty">
            <strong>当前任务尚无 AED 编辑记录</strong>
            <p>当 Agent 在当前对话里自动写盘或创建快照后，这里会显示 task-start、pre-tool 与 edit 条目。</p>
        </div>

        <AiRevertConfirmDialog
:open="dialogOpen" :title="dialogTitle" :description="dialogDescription"
            :confirm-text="dialogConfirmText" @close="dialogOpen = false" @confirm="handleDialogConfirm" />
    </section>
</template>

<style scoped>
.ai-edit-timeline {
    display: grid;
    gap: 12px;
    padding: 12px;
    border-bottom: 1px solid var(--shell-divider);
    background:
        linear-gradient(180deg, color-mix(in srgb, var(--sidebar-bg) 88%, #0b1020) 0%, transparent 100%),
        var(--sidebar-bg);
}

.ai-edit-timeline__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
}

.ai-edit-timeline__header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

.ai-edit-timeline__header strong {
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 700;
}

.ai-edit-timeline__header p {
    margin-top: 4px;
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.5;
}

.ai-edit-timeline__count {
    display: inline-flex;
    min-width: 24px;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: color-mix(in srgb, var(--shell-elevated) 88%, transparent);
    padding: 4px 8px;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 700;
}

.ai-edit-timeline__pin-button,
.ai-edit-timeline__revert-button {
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--shell-divider) 84%, transparent);
    background: color-mix(in srgb, var(--shell-elevated) 80%, transparent);
    padding: 6px 10px;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 600;
}

.ai-edit-timeline__pin-button {
    border-color: color-mix(in srgb, #56a8ff 26%, var(--shell-divider));
    color: color-mix(in srgb, #dcecff 86%, var(--text-secondary));
}

.ai-edit-timeline__pin-button:disabled,
.ai-edit-timeline__revert-button:disabled {
    cursor: not-allowed;
    opacity: 0.42;
}

.ai-edit-timeline__list {
    display: grid;
    gap: 10px;
    max-height: 420px;
    overflow: auto;
}

.ai-edit-timeline__entry {
    display: grid;
    gap: 8px;
}

.ai-edit-timeline__empty {
    display: grid;
    gap: 6px;
    border-radius: 16px;
    border: 1px dashed color-mix(in srgb, var(--shell-divider) 88%, transparent);
    padding: 14px;
    color: var(--text-secondary);
}

.ai-edit-timeline__empty strong {
    color: var(--text-primary);
    font-size: 13px;
}

.ai-edit-timeline__empty p {
    font-size: 12px;
    line-height: 1.6;
}
</style>
<script setup lang="ts">
import AppDropdownMenu from '@/components/common/AppDropdownMenu.vue';
import { useAiAutoApply } from '@/composables/useAiAutoApply';
import { useAiEditTimeline } from '@/composables/useAiEditTimeline';
import { useAiRevert } from '@/composables/useAiRevert';
import type { TAiEditAuthLevel } from '@/types/ai-edit';
import { computed, onMounted, ref, watch } from 'vue';

import AiRevertConfirmDialog from './AiRevertConfirmDialog.vue';

const autoApply = useAiAutoApply();
const timeline = useAiEditTimeline();
const revert = useAiRevert();

const dialogOpen = ref(false);
const dialogTitle = ref('');
const dialogDescription = ref('');
const dialogConfirmText = ref('确认回滚');
const pendingAction = ref<'undo-last' | 'revert-task' | 'restore-latest-snapshot' | null>(null);

const toneClass = computed(() => {
    switch (autoApply.authLevel.value) {
        case 'per_task':
            return 'is-task';
        case 'session':
            return 'is-session';
        default:
            return 'is-manual';
    }
});

const modeLabel = computed(() => {
    switch (autoApply.authLevel.value) {
        case 'per_task':
            return 'Auto-apply: per-task';
        case 'session':
            return 'Auto-apply: session';
        default:
            return 'Auto-apply: manual';
    }
});

const timelineCountLabel = computed(() => `${timeline.editedFileCount.value} 文件已编辑`);

const currentTaskSummary = computed(() => {
    if (!revert.currentTaskId.value) {
        return '当前任务暂无 AED 记录';
    }

    const entryCount = timeline.activeTaskEntries.value.length;
    return `当前任务 · ${entryCount} 条记录`;
});

const menuItems = computed(() => [
    {
        key: 'manual',
        label: '手动审批',
        description: '每次 patch 仍需用户确认',
        selected: autoApply.authLevel.value === 'manual',
    },
    {
        key: 'per_task',
        label: '任务内自动应用',
        description: '本轮 Agent Task 内自动写盘',
        selected: autoApply.authLevel.value === 'per_task',
    },
    {
        key: 'session',
        label: '会话内自动应用',
        description: '当前进程会话持续自动写盘',
        selected: autoApply.authLevel.value === 'session',
    },
    {
        key: 'undo-last',
        label: '撤销最近一次 AI 编辑',
        description: revert.latestUndoableOperation.value
            ? `当前文件 · ${revert.latestUndoableOperation.value.path}`
            : '当前任务暂无可撤销编辑',
        separatorBefore: true,
        disabled: !revert.canUndoLastEdit.value,
    },
    {
        key: 'revert-task',
        label: '回滚当前任务',
        description: currentTaskSummary.value,
        disabled: !revert.canRevertTask.value,
    },
    {
        key: 'restore-latest-snapshot',
        label: '恢复最近快照',
        description: revert.latestSnapshot.value?.label ?? '当前任务暂无快照',
        disabled: !revert.canRestoreLatestSnapshot.value,
    },
]);

const setAuthLevel = async (level: TAiEditAuthLevel): Promise<void> => {
    await autoApply.setAuthLevel({ level });
};

const syncTimeline = (): void => {
    const taskId = autoApply.activeTaskId.value;
    void timeline.loadTimeline(taskId ? { taskId } : {}).catch(() => undefined);
};

const openDialog = (
    action: 'undo-last' | 'revert-task' | 'restore-latest-snapshot',
): void => {
    pendingAction.value = action;

    if (action === 'undo-last') {
        dialogTitle.value = '确认撤销最近一次 AI 编辑';
        dialogDescription.value = revert.latestUndoableOperation.value
            ? `将恢复文件“${revert.latestUndoableOperation.value.path}”到这次 AED 编辑前的快照内容。`
            : '当前任务没有可撤销的 AED 编辑。';
        dialogConfirmText.value = '确认撤销';
    } else if (action === 'revert-task') {
        dialogTitle.value = '确认回滚当前任务';
        dialogDescription.value = revert.currentTaskId.value
            ? `将把当前任务涉及的 AED 编辑恢复到 task-start / pre-tool 快照记录的状态。`
            : '当前任务没有可回滚的 AED 记录。';
        dialogConfirmText.value = '确认回滚';
    } else {
        dialogTitle.value = '确认恢复最近快照';
        dialogDescription.value = revert.latestSnapshot.value
            ? `将把当前任务恢复到快照“${revert.latestSnapshot.value.label}”记录的内容。`
            : '当前任务没有可恢复的 AED 快照。';
        dialogConfirmText.value = '确认恢复';
    }

    dialogOpen.value = true;
};

const handleDialogConfirm = async (): Promise<void> => {
    if (!pendingAction.value) {
        dialogOpen.value = false;
        return;
    }

    const result = pendingAction.value === 'undo-last'
        ? await revert.undoLastEdit()
        : pendingAction.value === 'revert-task'
            ? await revert.revertCurrentTask()
            : await revert.restoreLatestSnapshot();

    if (result.status === 'success') {
        dialogOpen.value = false;
        pendingAction.value = null;
        syncTimeline();
        return;
    }

    dialogTitle.value = '回滚失败';
    dialogDescription.value = result.error.message;
    dialogConfirmText.value = '知道了';
    pendingAction.value = null;
};

const handleSelect = (key: string): void => {
    if (key === 'manual' || key === 'per_task' || key === 'session') {
        void setAuthLevel(key);
        return;
    }

    if (key === 'undo-last' || key === 'revert-task' || key === 'restore-latest-snapshot') {
        openDialog(key);
    }
};

onMounted(() => {
    autoApply.loadAuthState().catch(() => undefined);
    syncTimeline();
});

watch(
    () => autoApply.activeTaskId.value,
    () => {
        syncTimeline();
    },
);
</script>

<template>
    <AppDropdownMenu :items="menuItems" align="right" :min-width="248" @select="handleSelect">
        <template #trigger>
            <button type="button" class="ai-auto-apply-badge" :class="toneClass"
                :aria-label="`${modeLabel}，${timelineCountLabel}`">
                <span class="ai-auto-apply-dot" aria-hidden="true"></span>
                <span class="ai-auto-apply-label">{{ modeLabel }}</span>
                <span class="ai-auto-apply-divider" aria-hidden="true"></span>
                <span class="ai-auto-apply-meta">{{ timelineCountLabel }}</span>
            </button>
        </template>
    </AppDropdownMenu>

    <AiRevertConfirmDialog :open="dialogOpen" :title="dialogTitle" :description="dialogDescription"
        :confirm-text="dialogConfirmText" @close="dialogOpen = false" @confirm="handleDialogConfirm" />
</template>

<style scoped>
.ai-auto-apply-badge {
    display: inline-flex;
    height: 22px;
    align-items: center;
    gap: 6px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--shell-divider) 72%, transparent);
    background: color-mix(in srgb, var(--shell-elevated) 78%, transparent);
    padding: 0 10px;
    color: var(--text-secondary);
    transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease;
}

.ai-auto-apply-badge:hover {
    background: color-mix(in srgb, var(--shell-elevated) 88%, transparent);
}

.ai-auto-apply-dot {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text-tertiary) 88%, transparent);
}

.ai-auto-apply-label,
.ai-auto-apply-meta {
    white-space: nowrap;
    font-size: 11px;
    font-weight: 600;
}

.ai-auto-apply-divider {
    width: 1px;
    height: 10px;
    background: color-mix(in srgb, var(--shell-divider) 84%, transparent);
}

.ai-auto-apply-badge.is-manual {
    border-color: color-mix(in srgb, var(--shell-divider) 82%, transparent);
}

.ai-auto-apply-badge.is-manual .ai-auto-apply-dot {
    background: color-mix(in srgb, #8da0bf 72%, transparent);
}

.ai-auto-apply-badge.is-task {
    border-color: color-mix(in srgb, #56a8ff 36%, var(--shell-divider));
    background: color-mix(in srgb, #56a8ff 12%, var(--shell-elevated));
    color: #dcecff;
}

.ai-auto-apply-badge.is-task .ai-auto-apply-dot {
    background: #56a8ff;
}

.ai-auto-apply-badge.is-session {
    border-color: color-mix(in srgb, #f59e0b 42%, var(--shell-divider));
    background: color-mix(in srgb, #f59e0b 14%, var(--shell-elevated));
    color: #fff1cf;
}

.ai-auto-apply-badge.is-session .ai-auto-apply-dot {
    background: #f59e0b;
}
</style>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { IAiTaskPlanStep } from '@/types/ai';

const props = defineProps<{
    step: IAiTaskPlanStep;
    canRemove: boolean;
}>();

const emit = defineEmits<{
    updateTitle: [stepId: string, title: string];
    remove: [stepId: string];
}>();

const draftTitle = ref(props.step.title);

watch(
    () => props.step.title,
    (value) => {
        draftTitle.value = value;
    },
);

const statusLabel = computed(() => {
    switch (props.step.status) {
        case 'running':
            return '进行中';
        case 'done':
            return '已完成';
        case 'failed':
            return '失败';
        case 'skipped':
            return '已跳过';
        case 'cancelled':
            return '已取消';
        default:
            return '待处理';
    }
});

const commitTitle = (): void => {
    const nextTitle = draftTitle.value.trim();
    if (!nextTitle || nextTitle === props.step.title) {
        draftTitle.value = props.step.title;
        return;
    }

    emit('updateTitle', props.step.id, nextTitle);
};
</script>

<template>
    <li class="ai-plan-step-item">
        <header class="ai-plan-step-header">
            <span class="ai-plan-step-index">{{ step.index + 1 }}</span>
            <input v-model="draftTitle" class="ai-plan-step-title" type="text" aria-label="编辑计划步骤标题" @blur="commitTitle"
                @keydown.enter.prevent="commitTitle" />
            <span class="ai-plan-step-status">{{ statusLabel }}</span>
        </header>

        <p class="ai-plan-step-output">{{ step.expectedOutput }}</p>

        <footer class="ai-plan-step-meta">
            <span>风险：{{ step.riskLevel }}</span>
            <span>工具：{{ step.tools.join('、') }}</span>
            <button type="button" class="ai-plan-step-remove" :disabled="!canRemove" @click="emit('remove', step.id)">
                删除
            </button>
        </footer>
    </li>
</template>

<style scoped>
.ai-plan-step-item {
    display: grid;
    gap: 6px;
    border: 1px solid color-mix(in srgb, var(--shell-divider) 85%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--surface-soft) 70%, transparent);
    padding: 10px;
}

.ai-plan-step-header {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
}

.ai-plan-step-index {
    display: inline-grid;
    width: 18px;
    height: 18px;
    place-items: center;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent-strong) 25%, transparent);
    color: var(--text-primary);
    font-size: 11px;
    font-weight: 600;
}

.ai-plan-step-title {
    min-width: 0;
    flex: 1;
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 600;
}

.ai-plan-step-status {
    color: var(--text-quaternary);
    font-size: 11px;
    white-space: nowrap;
}

.ai-plan-step-output {
    margin: 0;
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.5;
}

.ai-plan-step-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    color: var(--text-quaternary);
    font-size: 11px;
}

.ai-plan-step-remove {
    margin-left: auto;
    color: var(--text-tertiary);
    font-size: 11px;
}

.ai-plan-step-remove:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
</style>
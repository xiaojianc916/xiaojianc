<script setup lang="ts">
import { computed } from 'vue';

import AiPlanApprovalBar from '@/components/business/ai/AiPlanApprovalBar.vue';
import AiPlanStepList from '@/components/business/ai/AiPlanStepList.vue';
import type { IAiTaskPlanStep } from '@/types/ai';

const props = defineProps<{
    goal: string;
    steps: IAiTaskPlanStep[];
    classificationReason: string;
    errorMessage: string;
    isPlanning: boolean;
    isApproving: boolean;
}>();

const emit = defineEmits<{
    updateStepTitle: [stepId: string, title: string];
    removeStep: [stepId: string];
    regenerate: [];
    reset: [];
    approve: [];
}>();

const canApprove = computed(() => props.steps.length >= 2 && props.steps.length <= 6);

const handleUpdateStepTitle = (stepId: string, title: string): void => {
    emit('updateStepTitle', stepId, title);
};

const handleRemoveStep = (stepId: string): void => {
    emit('removeStep', stepId);
};
</script>

<template>
    <section class="ai-plan-mode-panel" aria-label="计划模式">
        <header class="ai-plan-header">
            <h3>Plan Mode</h3>
            <span>{{ steps.length }} 步</span>
        </header>

        <p v-if="goal" class="ai-plan-goal">目标：{{ goal }}</p>
        <p v-if="classificationReason" class="ai-plan-reason">{{ classificationReason }}</p>
        <p v-if="errorMessage" class="ai-plan-error">{{ errorMessage }}</p>

        <div v-if="isPlanning" class="ai-plan-loading">计划生成中...</div>

        <AiPlanStepList v-if="steps.length" :steps="steps" @update-title="handleUpdateStepTitle"
            @remove-step="handleRemoveStep" />

        <AiPlanApprovalBar :is-planning="isPlanning" :is-approving="isApproving" :can-approve="canApprove"
            @regenerate="emit('regenerate')" @reset="emit('reset')" @approve="emit('approve')" />
    </section>
</template>

<style scoped>
.ai-plan-mode-panel {
    display: grid;
    gap: 10px;
    border-bottom: 1px solid var(--shell-divider);
    padding: 10px 12px;
}

.ai-plan-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.ai-plan-header h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 600;
}

.ai-plan-header span {
    color: var(--text-quaternary);
    font-size: 11px;
}

.ai-plan-goal,
.ai-plan-reason,
.ai-plan-error,
.ai-plan-loading {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
}

.ai-plan-goal {
    color: var(--text-secondary);
}

.ai-plan-reason {
    color: var(--text-tertiary);
}

.ai-plan-error {
    color: var(--danger);
}

.ai-plan-loading {
    color: var(--text-quaternary);
}
</style>
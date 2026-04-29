import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type {
    IAiAgentClassifyTaskPayload,
    IAiTaskPlanStep,
    TAiAgentTaskClassification,
} from '@/types/ai';

export type TAiAgentPanelMode = 'chat' | 'plan' | 'agent';

export const useAiAgentStore = defineStore('ai-agent', () => {
    const mode = ref<TAiAgentPanelMode>('chat');
    const activeGoal = ref<string>('');
    const steps = ref<IAiTaskPlanStep[]>([]);
    const classification = ref<TAiAgentTaskClassification | null>(null);
    const classificationReason = ref<string>('');
    const shouldEnterPlanMode = ref<boolean>(false);
    const isPlanning = ref<boolean>(false);
    const isApproving = ref<boolean>(false);
    const approvedAt = ref<string | null>(null);
    const errorMessage = ref<string>('');

    const hasPlan = computed(() => steps.value.length > 0);

    const setClassification = (payload: IAiAgentClassifyTaskPayload): void => {
        classification.value = payload.classification;
        shouldEnterPlanMode.value = payload.shouldEnterPlanMode;
        classificationReason.value = payload.reason;
    };

    const setPlan = (goal: string, nextSteps: IAiTaskPlanStep[]): void => {
        activeGoal.value = goal;
        steps.value = nextSteps;
    };

    const replaceStep = (stepId: string, nextStep: IAiTaskPlanStep): void => {
        steps.value = steps.value.map((step) => (step.id === stepId ? nextStep : step));
    };

    const removeStep = (stepId: string): void => {
        steps.value = steps.value.filter((step) => step.id !== stepId);
    };

    const clearPlan = (): void => {
        activeGoal.value = '';
        steps.value = [];
        approvedAt.value = null;
        classificationReason.value = '';
        classification.value = null;
        shouldEnterPlanMode.value = false;
        errorMessage.value = '';
    };

    return {
        mode,
        activeGoal,
        steps,
        classification,
        classificationReason,
        shouldEnterPlanMode,
        isPlanning,
        isApproving,
        approvedAt,
        errorMessage,
        hasPlan,
        setClassification,
        setPlan,
        replaceStep,
        removeStep,
        clearPlan,
    };
});
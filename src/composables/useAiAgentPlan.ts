import { ref } from 'vue';

import { aiService } from '@/services/modules/ai';
import { useAiAgentStore } from '@/store/aiAgent';
import { toErrorMessage } from '@/utils/error';

import type {
    IAiContextReference,
    IAiTaskPlanStep,
} from '@/types/ai';

const MIN_PLAN_STEPS = 2;
const MAX_PLAN_STEPS = 6;

const cloneContext = (
    context: IAiContextReference[],
): IAiContextReference[] => {
    return context.map((item) => ({ ...item }));
};

const assertValidGoal = (goal: string, message: string): void => {
    if (!goal.trim()) {
        throw new Error(message);
    }
};

const assertValidPlanSteps = (steps: IAiTaskPlanStep[]): void => {
    if (steps.length < MIN_PLAN_STEPS || steps.length > MAX_PLAN_STEPS) {
        throw new Error(`计划步骤数必须在 ${MIN_PLAN_STEPS} 到 ${MAX_PLAN_STEPS} 之间。`);
    }
};

export const useAiAgentPlan = () => {
    const store = useAiAgentStore();

    const latestContext = ref<IAiContextReference[]>([]);

    const classifyTask = async (
        goal: string,
        context: IAiContextReference[],
    ): Promise<void> => {
        store.isClassifying = true;
        store.errorMessage = '';

        try {
            const contextSnapshot = cloneContext(context);

            const payload = await aiService.classifyTask({
                goal,
                context: contextSnapshot,
            });

            latestContext.value = contextSnapshot;
            store.setClassification(payload);
        } catch (error) {
            store.errorMessage = toErrorMessage(error, '任务分类失败。');
            throw error;
        } finally {
            store.isClassifying = false;
        }
    };

    const createPlan = async (
        goal: string,
        context: IAiContextReference[],
    ): Promise<IAiTaskPlanStep[]> => {
        store.isPlanning = true;
        store.errorMessage = '';

        try {
            assertValidGoal(goal, '任务目标不能为空。');

            const contextSnapshot = cloneContext(context);

            const payload = await aiService.planTask({
                goal,
                context: contextSnapshot,
            });

            latestContext.value = contextSnapshot;
            store.mode = 'plan';
            store.setPlan(goal, payload.steps);

            return payload.steps;
        } catch (error) {
            store.errorMessage = toErrorMessage(error, '生成计划失败。');
            throw error;
        } finally {
            store.isPlanning = false;
        }
    };

    const regeneratePlan = async (): Promise<IAiTaskPlanStep[]> => {
        assertValidGoal(store.activeGoal, '当前没有可重生成的计划目标。');

        return createPlan(store.activeGoal, latestContext.value);
    };

    const updateStep = (
        stepId: string,
        partial: Partial<IAiTaskPlanStep>,
    ): void => {
        const current = store.steps.find((step) => step.id === stepId);

        if (!current) {
            return;
        }

        store.replaceStep(stepId, {
            ...current,
            ...partial,
            id: current.id,
        });
    };

    const removeStep = (stepId: string): void => {
        if (store.steps.length <= MIN_PLAN_STEPS) {
            throw new Error(`计划至少保留 ${MIN_PLAN_STEPS} 步。`);
        }

        store.removeStep(stepId);
    };

    const approvePlan = async (): Promise<void> => {
        assertValidGoal(store.activeGoal, '任务目标不能为空。');
        assertValidPlanSteps(store.steps);

        store.isApproving = true;
        store.errorMessage = '';

        try {
            const payload = await aiService.approvePlan({
                goal: store.activeGoal,
                steps: store.steps,
            });

            store.approvedAt = payload.approvedAt;
            store.mode = 'agent';
        } catch (error) {
            store.errorMessage = toErrorMessage(error, '批准计划失败。');
            throw error;
        } finally {
            store.isApproving = false;
        }
    };

    const resetPlan = (): void => {
        store.clearPlan();
        latestContext.value = [];
    };

    return {
        store,
        classifyTask,
        createPlan,
        regeneratePlan,
        updateStep,
        removeStep,
        approvePlan,
        resetPlan,
    };
};

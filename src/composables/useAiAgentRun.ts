import { aiService } from '@/services/modules/ai';
import { useAiAgentStore } from '@/store/aiAgent';
import type {
  IAiAgentRun,
  IAiContextReference,
  IAiTaskPlanStep,
  TAiToolConfirmationDecision,
} from '@/types/ai';

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return fallback;
};

export const useAiAgentRun = () => {
  const store = useAiAgentStore();

  const applyRunPayload = (run: IAiAgentRun): IAiAgentRun => {
    store.upsertRun(run);
    store.mode = 'agent';
    store.errorMessage = '';
    return run;
  };

  const runPlan = async (
    goal: string,
    steps: IAiTaskPlanStep[],
    context: IAiContextReference[] = [],
  ): Promise<IAiAgentRun> => {
    try {
      const payload = await aiService.runPlan({ goal, steps, context });
      return applyRunPayload(payload.run);
    } catch (error) {
      store.errorMessage = toErrorMessage(error, '启动 Agent run 失败。');
      throw error;
    }
  };

  const runStep = async (
    runId: string,
    stepId?: string,
  ): Promise<IAiAgentRun> => {
    try {
      const payload = await aiService.runStep({ runId, stepId });
      return applyRunPayload(payload.run);
    } catch (error) {
      store.errorMessage = toErrorMessage(error, '执行 Agent step 失败。');
      throw error;
    }
  };

  const pauseRun = async (runId: string): Promise<IAiAgentRun> => {
    try {
      const payload = await aiService.pauseRun({ runId });
      return applyRunPayload(payload.run);
    } catch (error) {
      store.errorMessage = toErrorMessage(error, '暂停 Agent run 失败。');
      throw error;
    }
  };

  const resumeRun = async (runId: string): Promise<IAiAgentRun> => {
    try {
      const payload = await aiService.resumeRun({ runId });
      return applyRunPayload(payload.run);
    } catch (error) {
      store.errorMessage = toErrorMessage(error, '继续 Agent run 失败。');
      throw error;
    }
  };

  const cancelRun = async (runId: string): Promise<IAiAgentRun> => {
    try {
      const payload = await aiService.cancelRun({ runId });
      return applyRunPayload(payload.run);
    } catch (error) {
      store.errorMessage = toErrorMessage(error, '取消 Agent run 失败。');
      throw error;
    }
  };

  const resolveToolConfirmation = async (
    runId: string,
    confirmationId: string,
    decision: TAiToolConfirmationDecision,
  ): Promise<IAiAgentRun> => {
    try {
      const payload = await aiService.resolveToolConfirmation({
        runId,
        confirmationId,
        decision,
      });
      store.clearPendingToolConfirmation(confirmationId);
      return applyRunPayload(payload.run);
    } catch (error) {
      store.errorMessage = toErrorMessage(error, '处理工具确认失败。');
      throw error;
    }
  };

  const refreshRun = async (runId: string): Promise<IAiAgentRun> => {
    const payload = await aiService.getRun({ runId });
    return applyRunPayload(payload.run);
  };

  const loadRuns = async (): Promise<IAiAgentRun[]> => {
    const payload = await aiService.listRuns();
    store.setRuns(payload.runs);
    return payload.runs;
  };

  return {
    store,
    runPlan,
    runStep,
    pauseRun,
    resumeRun,
    cancelRun,
    resolveToolConfirmation,
    refreshRun,
    loadRuns,
  };
};

import { computed, ref, type ComputedRef } from 'vue';
import type { useAiAgentRun } from '@/composables/ai/useAiAgentRun';
import type { useAiAssistant } from '@/composables/ai/useAiAssistant';
import type {
  IAiAgentRun,
  IAiTaskPlanStep,
  IAiToolActivityInline,
  TAiToolConfirmationDecision,
} from '@/types/ai';
import { readStoreValue } from '@/utils/ai/storeValue';
import { toErrorMessage } from '@/utils/error';

type AiAssistant = ReturnType<typeof useAiAssistant>;
type AiAgentRun = ReturnType<typeof useAiAgentRun>;

/**
 * plan / agent-run 领域的整块逻辑：store 解包、派生状态与运行操作。
 * 从 AiAssistantPanel 抽出，保持领域内聚，组件只负责接线与展示。
 */
export function useAiPlanController(
  assistant: AiAssistant,
  agentRun: AiAgentRun,
  workspaceRootPath: ComputedRef<string | null>,
) {
  const planStore = computed(() => assistant.agentPlan.store);

  const planHasPlan = computed(() => readStoreValue(planStore.value.hasPlan));
  const planIsClassifying = computed(() => readStoreValue(planStore.value.isClassifying));
  const planIsPlanning = computed(() => readStoreValue(planStore.value.isPlanning));
  const planClassificationReason = computed(() =>
    readStoreValue(planStore.value.classificationReason),
  );
  const planErrorMessage = computed(() => readStoreValue(planStore.value.errorMessage));
  const planIsApproving = computed(() => readStoreValue(planStore.value.isApproving));
  const planApprovedAt = computed(() => readStoreValue(planStore.value.approvedAt));
  const planSummary = computed(() => readStoreValue(planStore.value.planSummary));
  const planStatus = computed(() => readStoreValue(planStore.value.planStatus));
  const planId = computed(() => readStoreValue(planStore.value.planId));
  const planVersion = computed(() => readStoreValue(planStore.value.planVersion));
  const planThreadId = computed(() => readStoreValue(planStore.value.planThreadId));
  const planCreatedAt = computed(() => readStoreValue(planStore.value.planCreatedAt));
  const planUpdatedAt = computed(() => readStoreValue(planStore.value.planUpdatedAt));
  const planExecutedAt = computed(() => readStoreValue(planStore.value.planExecutedAt));
  const planRejectionReason = computed(() => readStoreValue(planStore.value.planRejectionReason));
  const planExecutionErrorMessage = computed(() =>
    readStoreValue(planStore.value.planErrorMessage),
  );
  const planVersions = computed(() => readStoreValue(planStore.value.planVersions));
  const planActiveRun = computed<IAiAgentRun | null>(() =>
    readStoreValue(planStore.value.activeRun),
  );
  const planActiveToolActivity = computed<IAiToolActivityInline | null>(() =>
    readStoreValue(planStore.value.activeToolActivity),
  );
  const planPendingToolConfirmation = computed(() =>
    readStoreValue(planStore.value.pendingToolConfirmation),
  );
  const planPendingSidecarSession = computed(() =>
    readStoreValue(planStore.value.pendingSidecarAgentSession),
  );
  const planSteps = computed<IAiTaskPlanStep[]>(() => readStoreValue(planStore.value.steps));
  const planActiveGoal = computed(() => readStoreValue(planStore.value.activeGoal));
  const planActiveRunId = computed<string | null>(() =>
    readStoreValue(planStore.value.activeRunId),
  );

  const isAgentRunActionPending = ref(false);

  const setPlanErrorMessage = (message: string): void => {
    Reflect.set(planStore.value, 'errorMessage', message);
  };

  const setPlanError = (error: unknown, fallback: string): void => {
    setPlanErrorMessage(toErrorMessage(error, fallback));
  };

  const visibleDirectToolConfirmation = computed(() => {
    const confirmation = planPendingToolConfirmation.value;

    if (!confirmation) {
      return null;
    }

    const session = planPendingSidecarSession.value;

    if (session?.threadId && session.threadId !== assistant.activeConversationId.value) {
      return null;
    }

    return confirmation;
  });

  const hasPlannedAgentState = computed(
    () =>
      planHasPlan.value ||
      planIsClassifying.value ||
      planIsPlanning.value ||
      Boolean(planErrorMessage.value) ||
      Boolean(planId.value) ||
      Boolean(planStatus.value) ||
      Boolean(planActiveRun.value),
  );
  const isPlanConfirmationStatus = computed(
    () =>
      planStatus.value === 'pending_approval' ||
      planStatus.value === 'draft' ||
      planStatus.value === 'rejected' ||
      !planStatus.value,
  );
  const planConfirmationVisible = computed(() => {
    if (assistant.activeMode.value !== 'plan') {
      return false;
    }

    return (
      planSteps.value.length > 0 &&
      !planActiveRun.value &&
      !planApprovedAt.value &&
      isPlanConfirmationStatus.value
    );
  });
  const canApprovePlan = computed(
    () =>
      planSteps.value.length >= 2 &&
      planSteps.value.length <= 6 &&
      !planActiveRun.value &&
      !planApprovedAt.value &&
      (planStatus.value === 'pending_approval' ||
        planStatus.value === 'draft' ||
        !planStatus.value),
  );
  const canEditPlan = computed(
    () =>
      !planActiveRun.value &&
      !planApprovedAt.value &&
      !planIsPlanning.value &&
      !planIsApproving.value &&
      !planIsClassifying.value &&
      (planStatus.value === 'draft' || !planStatus.value),
  );
  const planProgressVisible = computed(() => {
    if (assistant.activeMode.value !== 'plan') {
      return false;
    }

    return (
      Boolean(planActiveRun.value) ||
      Boolean(planActiveToolActivity.value) ||
      Boolean(planPendingToolConfirmation.value && planActiveRun.value) ||
      Boolean(planApprovedAt.value) ||
      planStatus.value === 'approved' ||
      planStatus.value === 'executing' ||
      planStatus.value === 'completed' ||
      planStatus.value === 'failed'
    );
  });
  const directToolConfirmationVisible = computed(() => {
    if (assistant.activeMode.value !== 'agent') {
      return false;
    }

    return Boolean(visibleDirectToolConfirmation.value) && !planProgressVisible.value;
  });
  const activePlanStep = computed(() => {
    const currentStepId = planActiveRun.value?.currentStepId;

    if (currentStepId) {
      return planSteps.value.find((step) => step.id === currentStepId) ?? null;
    }

    return planSteps.value.find((step) => step.isActive) ?? null;
  });

  const getActiveAgentRunId = (): string | null =>
    planActiveRunId.value ?? planActiveRun.value?.id ?? null;

  const withAgentRunAction = async <T>(
    action: (runId: string) => Promise<T>,
    fallback: string,
  ): Promise<T | null> => {
    const runId = getActiveAgentRunId();

    if (!runId) {
      setPlanErrorMessage('当前没有可执行的 Agent run。');
      return null;
    }

    isAgentRunActionPending.value = true;
    setPlanErrorMessage('');

    try {
      return await action(runId);
    } catch (error) {
      setPlanError(error, fallback);
      return null;
    } finally {
      isAgentRunActionPending.value = false;
    }
  };

  const handleUpdatePlanStepTitle = (stepId: string, title: string): void => {
    assistant.agentPlan.updateStep(stepId, { title });
  };

  const handleRemovePlanStep = (stepId: string): void => {
    try {
      assistant.agentPlan.removeStep(stepId);
    } catch (error) {
      setPlanError(error, '删除计划步骤失败。');
    }
  };

  const handleRegeneratePlan = async (): Promise<void> => {
    try {
      await assistant.agentPlan.regeneratePlan();
    } catch (error) {
      setPlanError(error, '重生成计划失败。');
    }
  };

  const handleApprovePlan = async (): Promise<void> => {
    try {
      await assistant.agentPlan.approvePlan();
      await agentRun.runPlanToCompletion(planActiveGoal.value, planSteps.value, {
        context: assistant.buildSidecarContextReferences(),
        workspaceRootPath: workspaceRootPath.value,
      });
    } catch (error) {
      setPlanError(error, '批准或启动计划失败。');
    }
  };

  const handleResetPlan = (): void => {
    assistant.agentPlan.resetPlan();
  };

  const handleRejectPlan = async (): Promise<void> => {
    try {
      await assistant.agentPlan.rejectPlan('用户拒绝当前计划。');
    } catch (error) {
      setPlanError(error, '拒绝计划失败。');
    }
  };

  const handleRunStep = async (): Promise<void> => {
    await withAgentRunAction(
      (runId) =>
        agentRun.runStepWithSidecar(runId, {
          goal: planActiveGoal.value,
          context: assistant.buildSidecarContextReferences(),
          workspaceRootPath: workspaceRootPath.value,
        }),
      '执行 Agent step 失败。',
    );
  };

  const handlePauseRun = async (): Promise<void> => {
    await withAgentRunAction((runId) => agentRun.pauseRun(runId), '暂停 Agent run 失败。');
  };

  const handleResumeRun = async (): Promise<void> => {
    const resumedRun = await withAgentRunAction(
      (runId) => agentRun.resumeRun(runId),
      '继续 Agent run 失败。',
    );

    if (!resumedRun) {
      return;
    }

    try {
      await agentRun.continueRunToCompletion(resumedRun.id, {
        goal: planActiveGoal.value,
        context: assistant.buildSidecarContextReferences(),
        workspaceRootPath: workspaceRootPath.value,
      });
    } catch (error) {
      setPlanError(error, '继续执行计划失败。');
    }
  };

  const handleCancelRun = async (): Promise<void> => {
    await withAgentRunAction((runId) => agentRun.cancelRun(runId), '取消 Agent run 失败。');
  };

  const handleResolveToolConfirmation = async (
    decision: TAiToolConfirmationDecision,
  ): Promise<void> => {
    const confirmation = planPendingToolConfirmation.value;

    if (!confirmation) {
      setPlanErrorMessage('当前没有待处理的工具确认。');
      return;
    }

    if (!planActiveRun.value) {
      isAgentRunActionPending.value = true;
      setPlanErrorMessage('');

      try {
        await assistant.resolveSidecarToolConfirmation(decision);
      } catch (error) {
        setPlanError(error, '处理 Provider 工具确认失败。');
      } finally {
        isAgentRunActionPending.value = false;
      }

      return;
    }

    if (agentRun.hasSidecarStepToolConfirmation(confirmation.id)) {
      isAgentRunActionPending.value = true;
      setPlanErrorMessage('');
      let resolvedRun: IAiAgentRun | null = null;

      try {
        resolvedRun = await agentRun.resolveSidecarStepToolConfirmation(confirmation.id, decision);
      } catch (error) {
        setPlanError(error, '处理 Sidecar step 工具确认失败。');
      } finally {
        isAgentRunActionPending.value = false;
      }

      if (resolvedRun?.status === 'running-plan') {
        try {
          await agentRun.continueRunToCompletion(resolvedRun.id, {
            goal: planActiveGoal.value,
            context: assistant.buildSidecarContextReferences(),
            workspaceRootPath: workspaceRootPath.value,
          });
        } catch (error) {
          setPlanError(error, '继续执行计划失败。');
        }
      }

      return;
    }

    setPlanErrorMessage('Legacy Agent 工具确认链已移除，请使用官方 sidecar 审批链。');
  };

  const restorePersistedPlanUiState = async (): Promise<void> => {
    if (!hasPlannedAgentState.value && planStore.value.mode !== 'plan') {
      return;
    }

    assistant.activeMode.value = 'plan';
    await assistant.agentPlan.restorePersistedPlanState();
  };

  return {
    planStore,
    planHasPlan,
    planIsClassifying,
    planIsPlanning,
    planClassificationReason,
    planErrorMessage,
    planIsApproving,
    planApprovedAt,
    planSummary,
    planStatus,
    planId,
    planVersion,
    planThreadId,
    planCreatedAt,
    planUpdatedAt,
    planExecutedAt,
    planRejectionReason,
    planExecutionErrorMessage,
    planVersions,
    planActiveRun,
    planActiveToolActivity,
    planPendingToolConfirmation,
    planPendingSidecarSession,
    planSteps,
    planActiveGoal,
    planActiveRunId,
    isAgentRunActionPending,
    visibleDirectToolConfirmation,
    hasPlannedAgentState,
    isPlanConfirmationStatus,
    planConfirmationVisible,
    canApprovePlan,
    canEditPlan,
    planProgressVisible,
    directToolConfirmationVisible,
    activePlanStep,
    setPlanErrorMessage,
    setPlanError,
    getActiveAgentRunId,
    withAgentRunAction,
    handleUpdatePlanStepTitle,
    handleRemovePlanStep,
    handleRegeneratePlan,
    handleApprovePlan,
    handleResetPlan,
    handleRejectPlan,
    handleRunStep,
    handlePauseRun,
    handleResumeRun,
    handleCancelRun,
    handleResolveToolConfirmation,
    restorePersistedPlanUiState,
  };
}

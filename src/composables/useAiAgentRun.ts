import { aiService } from '@/services/modules/ai';
import { useAiAgentStore } from '@/store/aiAgent';
import { AI_AGENT_TOOL_LOOP_DEFAULT_MAX_TURNS } from '@/types/ai-agent.schema';
import { toErrorMessage } from '@/utils/error';
import type {
  IAiAgentRun,
  IAiAgentStepToolResultSummary,
  IAiAgentToolLoopResult,
  IAiChatMessage,
  IAiContextReference,
  IAiTaskPlanStep,
  TAiToolConfirmationDecision,
} from '@/types/ai';

interface IProviderStepLoopOptions {
  goal: string;
  context?: IAiContextReference[];
  workspaceRootPath?: string | null;
}

interface IProviderStepLoopSession {
  runId: string;
  stepId: string;
  messages: IAiChatMessage[];
  context: IAiContextReference[];
  workspaceRootPath?: string | null;
  toolDecisions: Record<string, TAiToolConfirmationDecision>;
  pendingDecisionKey?: string | null;
}

const MAX_PROVIDER_STEP_TOOL_TURNS = AI_AGENT_TOOL_LOOP_DEFAULT_MAX_TURNS;
const PROVIDER_STEP_CONFIRMATION_PREFIX = 'provider-step-tool-confirmation:';

const findRunningStep = (run: IAiAgentRun | null): IAiTaskPlanStep | null =>
  run?.steps.find((step) => step.status === 'running') ?? null;

const createMessageId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const buildStepToolLoopMessages = (
  run: IAiAgentRun,
  step: IAiTaskPlanStep,
  goal: string,
): IAiChatMessage[] => {
  const createdAt = new Date().toISOString();
  const toolList = step.tools.length ? step.tools.join(', ') : '未限定，按任务需要选择已注册工具';

  return [
    {
      id: createMessageId('agent-step-system'),
      role: 'system',
      content: [
        '你正在执行 IDE Agent Plan 的单个步骤。',
        '必须围绕当前步骤目标调用已注册工具；不要执行与当前步骤无关的操作。',
        '工具结果会被结构化回灌；如果需要高风险工具，等待用户在 AI 面板内联确认。',
        '写盘必须通过 propose_patch / auto_apply_patch，并由 AED 负责应用与回滚。',
      ].join('\n'),
      createdAt,
      references: [],
    },
    {
      id: createMessageId('agent-step-user'),
      role: 'user',
      content: [
        `任务目标：${goal || run.goal}`,
        `当前步骤：${step.title}`,
        `步骤目标：${step.goal}`,
        `预期产物：${step.expectedOutput}`,
        `建议工具：${toolList}`,
        '请执行这个步骤，并在完成后给出简短结论。',
      ].join('\n'),
      createdAt,
      references: step.references ?? [],
    },
  ];
};

const toStepToolResultSummary = (
  runId: string,
  stepId: string,
  result: IAiAgentToolLoopResult,
): IAiAgentStepToolResultSummary => ({
  id: result.id,
  runId,
  stepId,
  toolName: result.toolName,
  status: result.status,
  summary: result.summary,
  startedAt: result.startedAt,
  endedAt: result.endedAt,
  ...(result.outputRef ? { outputRef: result.outputRef } : {}),
});

const createProviderStepConfirmationId = (
  session: IProviderStepLoopSession,
  originalConfirmationId: string,
): string =>
  `${PROVIDER_STEP_CONFIRMATION_PREFIX}${session.runId}:${session.stepId}:${originalConfirmationId}`;

export const useAiAgentRun = () => {
  const store = useAiAgentStore();
  const providerStepLoopSessions = new Map<string, IProviderStepLoopSession>();

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

  const executeProviderStepLoop = async (
    session: IProviderStepLoopSession,
  ): Promise<IAiAgentRun> => {
    const payload = await aiService.toolLoopChat({
      runId: session.runId,
      messages: session.messages,
      context: session.context,
      workspaceRootPath: session.workspaceRootPath ?? null,
      toolDecisions: session.toolDecisions,
      maxToolTurns: MAX_PROVIDER_STEP_TOOL_TURNS,
    });

    store.appendStepToolResults(
      session.runId,
      session.stepId,
      payload.toolResults.map((result) =>
        toStepToolResultSummary(session.runId, session.stepId, result),
      ),
    );

    for (const result of payload.toolResults) {
      store.appendToolActivity(session.runId, {
        id: `${result.id}:activity`,
        stepId: session.stepId,
        toolName: result.toolName,
        state: result.requiresUserConfirmation
          ? 'waiting-confirmation'
          : result.status === 'succeeded' ? 'succeeded' : 'failed',
        label: result.requiresUserConfirmation
          ? `等待确认 ${result.toolName}…`
          : `${result.toolName}: ${result.summary}`,
        startedAt: result.startedAt,
      });
    }

    if (payload.pendingConfirmation) {
      const originalId = payload.pendingConfirmation.id;
      const confirmationId = createProviderStepConfirmationId(session, originalId);
      const nextSession: IProviderStepLoopSession = {
        ...session,
        pendingDecisionKey: payload.pendingDecisionKey ?? originalId,
      };

      providerStepLoopSessions.set(confirmationId, nextSession);
      store.setPendingToolConfirmation({
        ...payload.pendingConfirmation,
        id: confirmationId,
        runId: session.runId,
        stepId: session.stepId,
      });

      const activeRun = store.activeRun;
      if (!activeRun) {
        throw new Error('Provider step loop 已暂停，但当前 Agent run 不存在。');
      }
      return activeRun;
    }

    const failedResult = payload.toolResults.find((result) => result.status === 'failed');
    if (failedResult) {
      store.errorMessage = failedResult.summary || 'Provider tool-use step 执行失败。';
      const activeRun = store.activeRun;
      if (!activeRun) {
        throw new Error(store.errorMessage);
      }
      return activeRun;
    }

    const completedPayload = await aiService.runStep({
      runId: session.runId,
      stepId: session.stepId,
      skipToolExecution: true,
    });

    return applyRunPayload(completedPayload.run);
  };

  const runStepWithProviderLoop = async (
    runId: string,
    options: IProviderStepLoopOptions,
  ): Promise<IAiAgentRun> => {
    try {
      let run = store.activeRun?.id === runId ? store.activeRun : null;
      let step = findRunningStep(run);

      if (!step) {
        const startedPayload = await aiService.runStep({ runId });
        run = applyRunPayload(startedPayload.run);
        step = findRunningStep(run);
      }

      if (!run || !step) {
        throw new Error('当前没有可执行的 Agent step。');
      }

      const session: IProviderStepLoopSession = {
        runId,
        stepId: step.id,
        messages: buildStepToolLoopMessages(run, step, options.goal),
        context: options.context ?? [],
        workspaceRootPath: options.workspaceRootPath ?? null,
        toolDecisions: {},
      };

      return await executeProviderStepLoop(session);
    } catch (error) {
      store.errorMessage = toErrorMessage(error, '执行 Agent step 失败。');
      throw error;
    }
  };

  const hasProviderStepToolConfirmation = (confirmationId: string): boolean =>
    providerStepLoopSessions.has(confirmationId);

  const resolveProviderStepToolConfirmation = async (
    confirmationId: string,
    decision: TAiToolConfirmationDecision,
  ): Promise<IAiAgentRun> => {
    const session = providerStepLoopSessions.get(confirmationId);
    const confirmation = store.pendingToolConfirmation;

    if (!session || !confirmation) {
      throw new Error('当前没有可继续的 Provider step 工具确认。');
    }

    providerStepLoopSessions.delete(confirmationId);
    store.clearPendingToolConfirmation(confirmationId);

    if (decision === 'stop') {
      return cancelRun(session.runId);
    }

    const decisionKey = session.pendingDecisionKey ?? confirmation.toolName;
    return executeProviderStepLoop({
      ...session,
      toolDecisions: {
        ...session.toolDecisions,
        [decisionKey]: decision,
        [confirmation.toolName]: decision,
      },
    });
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
    runStepWithProviderLoop,
    pauseRun,
    resumeRun,
    cancelRun,
    resolveToolConfirmation,
    hasProviderStepToolConfirmation,
    resolveProviderStepToolConfirmation,
    refreshRun,
    loadRuns,
  };
};

import type {
  IAiAgentRun,
  IAiAgentStepFinalAnswer,
  IAiChatMessage,
  IAiTaskPlanStep,
  IAiToolActivityInline,
  IAiToolCall,
} from '@/types/ai';

/**
 * 与组件状态无关的「Agent 流程消息 / 工具活动」构建纯函数集合。
 * 全部为纯函数，便于单测，且不持有任何响应式依赖。
 */

export const mapActivityToToolCallStatus = (
  state: IAiToolActivityInline['state'],
): IAiToolCall['status'] => {
  switch (state) {
    case 'starting':
    case 'running':
    case 'waiting-confirmation':
      return 'running';
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'denied';
    default:
      return 'running';
  }
};

export const isLiveToolActivity = (activity: IAiToolActivityInline): boolean =>
  activity.state === 'starting' ||
  activity.state === 'running' ||
  activity.state === 'waiting-confirmation';

export const normalizeToolActivitySummary = (activity: IAiToolActivityInline): string => {
  const source = activity.targetPreview?.trim() || activity.label.trim();
  const withoutEllipsis = source.replace(/…+$/u, '').trim();
  const withoutPrefix = withoutEllipsis
    .replace(/^正在(?:读取|搜索|加载|使用|应用|生成|验证|执行)\s*[：:：]?\s*/u, '')
    .replace(/^已(?:读取|搜索|加载|使用|应用|生成|验证|执行)\s*[：:：]?\s*/u, '')
    .trim();

  return withoutPrefix || withoutEllipsis || activity.toolName;
};

export const buildAgentFlowToolCalls = (
  run: IAiAgentRun | null,
  toolActivities: IAiToolActivityInline[],
): IAiToolCall[] => {
  if (!run) {
    return [];
  }

  return toolActivities
    .filter((activity) => run.status !== 'paused' || !isLiveToolActivity(activity))
    .map((activity) => ({
      id: activity.id,
      name: activity.toolName,
      status: mapActivityToToolCallStatus(activity.state),
      summary: activity.label,
      targetPreview: normalizeToolActivitySummary(activity),
    }));
};

export const buildPlanRunFinalAnswer = (
  run: IAiAgentRun,
  stepFinalAnswers: IAiAgentStepFinalAnswer[],
): string => {
  if (run.status === 'failed') {
    return `计划执行失败：${run.errorMessage ?? '执行过程中出现错误。'}`;
  }

  if (run.status === 'cancelled') {
    return '计划执行已取消。';
  }

  const answerByStepId = new Map(
    stepFinalAnswers.map((answer) => [answer.stepId, answer.content.trim()]),
  );
  const resultLines = run.steps
    .filter((step) => step.status === 'done')
    .map((step) => {
      const answer = answerByStepId.get(step.id);
      return answer ? `- ${step.title}：${answer}` : `- ${step.title}：已完成。`;
    });

  return [
    '已完成这轮计划执行。',
    ...(resultLines.length ? ['', '执行结果：', ...resultLines] : []),
  ].join('\n');
};

export const isAgentTokenMessage = (message: IAiChatMessage): boolean =>
  message.role !== 'assistant' ||
  Boolean(message.toolCalls?.length) ||
  Boolean(message.stream?.runtimeEvents?.length);

export const resolvePlanTokenStep = (run: IAiAgentRun | null): IAiTaskPlanStep | null => {
  if (!run) {
    return null;
  }

  if (run.currentStepId) {
    return run.steps.find((step) => step.id === run.currentStepId) ?? null;
  }

  return (
    run.steps.find((step) => step.status === 'running') ??
    run.steps.find((step) => step.status === 'pending') ??
    null
  );
};

export const buildPlanTokenEstimationMessages = (
  goal: string,
  step: IAiTaskPlanStep,
  createdAt: string,
): IAiChatMessage[] => {
  const toolList = step.tools.length ? step.tools.join(', ') : '未限定，按任务需要选择可用工具';

  return [
    {
      id: `plan-token-system:${step.id}`,
      role: 'system',
      content: [
        '你正在执行 IDE Agent Plan 的单个步骤。',
        '必须围绕当前步骤目标调用可用工具；不要执行与当前步骤无关的操作。',
        '如果需要高风险工具，请通过 sidecar approval 事件等待用户确认。',
        '写盘、删除、命令、安装依赖和 Git 操作都必须保留可回滚语义。',
      ].join('\n'),
      createdAt,
      references: [],
    },
    {
      id: `plan-token-user:${step.id}`,
      role: 'user',
      content: [
        `任务目标：${goal}`,
        `当前步骤：${step.title}`,
        `步骤目标：${step.goal}`,
        `预期产物：${step.expectedOutput}`,
        `建议工具：${toolList}`,
        '请执行这个步骤，并在完成后给出简短结论。',
      ].join('\n'),
      createdAt,
      references: [],
    },
  ];
};

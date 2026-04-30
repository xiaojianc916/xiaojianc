<script setup lang="ts">
import { computed } from 'vue';

import AiChangedFilesSummary from '@/components/business/ai/AiChangedFilesSummary.vue';
import type {
  IAiAgentPatchSummary,
  IAiAgentRun,
  IAiAgentStepDetail,
  IAiAgentStepWebSourceSummary,
  IAiAgentTimelineItem,
  IAiTaskPlanStep,
  TAiAgentPlanStepStatus,
  TAiAgentRunStatus,
  TAiAgentTimelineItemStatus,
  TAiAgentTimelineItemType,
  TAiWebSourceEntryStatus,
} from '@/types/ai';

const props = defineProps<{
  run: IAiAgentRun;
  stepDetails: Record<string, IAiAgentStepDetail>;
  patchSummaries?: readonly IAiAgentPatchSummary[];
}>();

const emit = defineEmits<{
  openDiff: [payload: {
    diffRef: string;
    filePath: string;
    patchRef?: string;
    runId: string;
    stepId: string;
  }];
}>();

interface IAiTimelineStepGroup {
  item: IAiAgentTimelineItem;
  step: IAiTaskPlanStep;
  children: IAiAgentTimelineItem[];
  patchSummaries: IAiAgentPatchSummary[];
  shouldOpen: boolean;
  isActive: boolean;
}

const RUN_STATUS_LABELS: Record<TAiAgentRunStatus, string> = {
  'waiting-for-plan-approval': '等待批准',
  'running-plan': '运行中',
  'running-step': '执行步骤中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const STEP_STATUS_LABELS: Record<TAiAgentPlanStepStatus, string> = {
  pending: '待执行',
  running: '执行中',
  done: '已完成',
  failed: '失败',
  skipped: '已跳过',
  cancelled: '已取消',
};

const TIMELINE_STATUS_LABELS: Record<TAiAgentTimelineItemStatus, string> = {
  pending: '待执行',
  running: '执行中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
  skipped: '已跳过',
};

const TIMELINE_TYPE_LABELS: Record<TAiAgentTimelineItemType, string> = {
  step: 'Step',
  'tool-result': 'Tool',
  'web-source': 'Web',
};

const stepDetailKey = (runId: string, stepId: string): string => `${runId}:${stepId}`;

const toStepTimelineStatus = (status: TAiAgentPlanStepStatus): TAiAgentTimelineItemStatus => {
  switch (status) {
    case 'done':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'running':
      return 'running';
    case 'cancelled':
      return 'cancelled';
    case 'skipped':
      return 'skipped';
    case 'pending':
    default:
      return 'pending';
  }
};

const toWebSourceTimelineStatus = (
  status: TAiWebSourceEntryStatus,
): TAiAgentTimelineItemStatus => {
  switch (status) {
    case 'fetching':
      return 'running';
    case 'failed':
      return 'failed';
    case 'fetched':
    case 'search-result':
    default:
      return 'succeeded';
  }
};

const getHostname = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

const getStepMetaLabel = (step: IAiTaskPlanStep): string =>
  `${STEP_STATUS_LABELS[step.status]} · ${step.kind} · 风险 ${step.riskLevel}`;

const getTimelineStatusLabel = (status: TAiAgentTimelineItemStatus): string =>
  TIMELINE_STATUS_LABELS[status];

const getTimelineTypeLabel = (type: TAiAgentTimelineItemType): string =>
  TIMELINE_TYPE_LABELS[type];

const buildStepItem = (
  run: IAiAgentRun,
  step: IAiTaskPlanStep,
  detail: IAiAgentStepDetail | null,
): IAiAgentTimelineItem => ({
  id: `${run.id}:${step.id}:step`,
  runId: run.id,
  stepId: step.id,
  type: 'step',
  title: step.title,
  status: toStepTimelineStatus(step.status),
  createdAt: detail?.updatedAt ?? run.updatedAt,
  subtitle: step.expectedOutput,
});

const buildToolItems = (
  detail: IAiAgentStepDetail | null,
): IAiAgentTimelineItem[] => {
  if (!detail) {
    return [];
  }

  return detail.toolResults.map((result) => {
    const item: IAiAgentTimelineItem = {
      id: result.id,
      runId: result.runId,
      stepId: result.stepId,
      type: 'tool-result',
      title: result.toolName,
      status: toToolResultTimelineStatus(result.status),
      createdAt: result.endedAt,
      subtitle: result.summary,
    };

    if (result.outputRef) {
      item.detailRef = result.outputRef;
    }

    return item;
  });
};

const toToolResultTimelineStatus = (status: string): TAiAgentTimelineItemStatus => {
  if (status === 'succeeded') {
    return 'succeeded';
  }
  if (status === 'failed') {
    return 'failed';
  }
  return 'running';
};

const buildWebSourceItem = (
  runId: string,
  stepId: string,
  source: IAiAgentStepWebSourceSummary,
): IAiAgentTimelineItem => {
  const hostname = getHostname(source.url);
  const queryPreview = source.queryPreview.trim();
  const item: IAiAgentTimelineItem = {
    id: `${runId}:${stepId}:web-source:${source.id}`,
    runId,
    stepId,
    type: 'web-source',
    title: source.title,
    status: toWebSourceTimelineStatus(source.status),
    createdAt: source.fetchedAt,
    subtitle: queryPreview ? `${hostname} · ${queryPreview}` : hostname,
  };

  if (source.textRef) {
    item.detailRef = source.textRef;
  }

  return item;
};

const buildWebSourceItems = (
  runId: string,
  detail: IAiAgentStepDetail | null,
): IAiAgentTimelineItem[] => {
  if (!detail) {
    return [];
  }

  return detail.webSources.map((source) =>
    buildWebSourceItem(runId, detail.stepId, source),
  );
};

const toTimestamp = (value: string): number => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const getPatchTimestamp = (summary: IAiAgentPatchSummary): number =>
  toTimestamp(summary.appliedAt ?? summary.revertedAt ?? '');

const getPatchSummariesForStep = (stepId: string): IAiAgentPatchSummary[] =>
  [...(props.patchSummaries ?? [])]
    .filter((summary) => summary.stepId === stepId)
    .sort((left, right) => getPatchTimestamp(left) - getPatchTimestamp(right));

const findPatchSummaryByDiffRef = (
  diffRef: string,
): IAiAgentPatchSummary | null =>
  (props.patchSummaries ?? []).find((summary) =>
    summary.files.some((file) => file.diffRef === diffRef),
  ) ?? null;

const handleViewDiff = (diffRef: string, filePath: string): void => {
  const summary = findPatchSummaryByDiffRef(diffRef);
  emit('openDiff', {
    diffRef,
    filePath,
    ...(summary?.patchRef ? { patchRef: summary.patchRef } : {}),
    runId: summary?.runId ?? props.run.id,
    stepId: summary?.stepId ?? '',
  });
};

const timelineGroups = computed<IAiTimelineStepGroup[]>(() => {
  const orderedSteps = [...props.run.steps].sort((left, right) => left.index - right.index);

  return orderedSteps.map((step) => {
    const detail = props.stepDetails[stepDetailKey(props.run.id, step.id)] ?? null;
    const item = buildStepItem(props.run, step, detail);
    const patchSummaries = getPatchSummariesForStep(step.id);
    const children = [
      ...buildToolItems(detail),
      ...buildWebSourceItems(props.run.id, detail),
    ].sort((left, right) => toTimestamp(left.createdAt) - toTimestamp(right.createdAt));
    const isActive = props.run.currentStepId === step.id || step.isActive === true || step.status === 'running';

    return {
      item,
      step,
      children,
      patchSummaries,
      shouldOpen: isActive || item.status === 'failed' || patchSummaries.length > 0,
      isActive,
    };
  });
});

const completedStepCount = computed(() =>
  props.run.steps.filter((step) => step.status === 'done').length,
);

const runStatusLabel = computed(() => RUN_STATUS_LABELS[props.run.status]);
</script>

<template>
  <section class="ai-agent-run-timeline" aria-label="Agent Run Timeline">
    <header class="ai-agent-run-timeline-header">
      <div class="ai-agent-run-timeline-title">
        <strong>Run Timeline</strong>
        <span>{{ runStatusLabel }}</span>
      </div>
      <span>{{ completedStepCount }}/{{ run.steps.length }} 步</span>
    </header>

    <p v-if="run.errorMessage" class="ai-agent-run-timeline-error">
      {{ run.errorMessage }}
    </p>

    <ol class="ai-agent-timeline-list">
      <li
        v-for="group in timelineGroups"
        :key="group.item.id"
        class="ai-agent-timeline-step"
        :class="[
          `is-${group.item.status}`,
          { 'is-active': group.isActive },
        ]"
      >
        <details class="ai-agent-timeline-details" :open="group.shouldOpen">
          <summary class="ai-agent-timeline-summary">
            <span class="ai-agent-timeline-marker" aria-hidden="true"></span>
            <span class="ai-agent-timeline-copy">
              <span class="ai-agent-timeline-title-row">
                <strong class="ai-agent-timeline-step-title">{{ group.item.title }}</strong>
                <em>{{ getTimelineStatusLabel(group.item.status) }}</em>
              </span>
              <span class="ai-agent-timeline-subtitle">{{ getStepMetaLabel(group.step) }}</span>
              <span class="ai-agent-timeline-subtitle">产物：{{ group.item.subtitle }}</span>
            </span>
          </summary>

          <div v-if="group.children.length" class="ai-agent-timeline-children">
            <article
              v-for="child in group.children"
              :key="child.id"
              class="ai-agent-timeline-child"
              :class="`is-${child.status}`"
            >
              <span class="ai-agent-timeline-child-marker" aria-hidden="true"></span>
              <div class="ai-agent-timeline-child-copy">
                <header class="ai-agent-timeline-child-header">
                  <span>{{ getTimelineTypeLabel(child.type) }}</span>
                  <strong>{{ child.title }}</strong>
                  <em>{{ getTimelineStatusLabel(child.status) }}</em>
                </header>
                <p v-if="child.subtitle">{{ child.subtitle }}</p>
                <p v-if="child.detailRef" class="ai-agent-timeline-ref">ref: {{ child.detailRef }}</p>
              </div>
            </article>
          </div>

          <div v-if="group.patchSummaries.length" class="ai-agent-timeline-patches">
            <AiChangedFilesSummary
              v-for="summary in group.patchSummaries"
              :key="summary.id"
              :summary="summary"
              @view-diff="handleViewDiff"
            />
          </div>

          <p v-if="!group.children.length && !group.patchSummaries.length" class="ai-agent-timeline-empty">
            暂无工具结果
          </p>
        </details>
      </li>
    </ol>

  </section>
</template>

<style scoped>
.ai-agent-run-timeline {
  display: grid;
  gap: 9px;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 86%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface-soft) 44%, transparent);
  padding: 10px;
}

.ai-agent-run-timeline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ai-agent-run-timeline-title {
  display: inline-flex;
  min-width: 0;
  align-items: baseline;
  gap: 7px;
}

.ai-agent-run-timeline-title strong {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
}

.ai-agent-run-timeline-title span,
.ai-agent-run-timeline-header > span {
  color: var(--text-quaternary);
  font-size: 11px;
}

.ai-agent-run-timeline-error {
  margin: 0;
  border: 1px solid color-mix(in srgb, var(--danger) 24%, var(--shell-divider));
  border-radius: 8px;
  background: color-mix(in srgb, var(--danger) 8%, transparent);
  color: var(--danger);
  font-size: 11px;
  line-height: 16px;
  padding: 7px 8px;
  overflow-wrap: anywhere;
}

.ai-agent-timeline-list {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ai-agent-timeline-step {
  position: relative;
  min-width: 0;
  padding: 0 0 0 18px;
}

.ai-agent-timeline-step::before {
  position: absolute;
  top: 18px;
  bottom: 0;
  left: 5px;
  width: 1px;
  background: color-mix(in srgb, var(--shell-divider) 80%, transparent);
  content: '';
}

.ai-agent-timeline-step:last-child::before {
  display: none;
}

.ai-agent-timeline-details {
  min-width: 0;
}

.ai-agent-timeline-summary {
  position: relative;
  display: flex;
  min-width: 0;
  cursor: pointer;
  gap: 9px;
  border-radius: 8px;
  padding: 7px 8px 7px 0;
}

.ai-agent-timeline-summary::-webkit-details-marker {
  display: none;
}

.ai-agent-timeline-summary:hover {
  background: color-mix(in srgb, var(--surface-soft) 42%, transparent);
}

.ai-agent-timeline-marker {
  position: absolute;
  top: 12px;
  left: -18px;
  width: 11px;
  height: 11px;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 88%, transparent);
  border-radius: 999px;
  background: var(--sidebar-bg);
}

.ai-agent-timeline-step.is-running .ai-agent-timeline-marker {
  border-color: color-mix(in srgb, var(--accent-strong) 58%, var(--shell-divider));
  background: color-mix(in srgb, var(--accent-strong) 24%, var(--sidebar-bg));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-strong) 10%, transparent);
}

.ai-agent-timeline-step.is-succeeded .ai-agent-timeline-marker {
  border-color: color-mix(in srgb, var(--success) 58%, var(--shell-divider));
  background: color-mix(in srgb, var(--success) 22%, var(--sidebar-bg));
}

.ai-agent-timeline-step.is-failed .ai-agent-timeline-marker {
  border-color: color-mix(in srgb, var(--danger) 68%, var(--shell-divider));
  background: color-mix(in srgb, var(--danger) 20%, var(--sidebar-bg));
}

.ai-agent-timeline-step.is-cancelled .ai-agent-timeline-marker,
.ai-agent-timeline-step.is-skipped .ai-agent-timeline-marker {
  background: color-mix(in srgb, var(--text-quaternary) 12%, var(--sidebar-bg));
}

.ai-agent-timeline-step.is-active .ai-agent-timeline-summary {
  background: color-mix(in srgb, var(--accent-strong) 8%, transparent);
}

.ai-agent-timeline-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.ai-agent-timeline-title-row,
.ai-agent-timeline-child-header {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 6px;
}

.ai-agent-timeline-step-title,
.ai-agent-timeline-child-header strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-agent-timeline-title-row em,
.ai-agent-timeline-child-header em {
  flex: 0 0 auto;
  color: var(--text-quaternary);
  font-size: 10px;
  font-style: normal;
  line-height: 14px;
}

.ai-agent-timeline-subtitle {
  min-width: 0;
  overflow: hidden;
  color: var(--text-quaternary);
  font-size: 11px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-agent-timeline-children,
.ai-agent-timeline-patches {
  display: grid;
  gap: 6px;
  margin: 0 0 7px;
  padding-left: 4px;
}

.ai-agent-timeline-child {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 7px;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 72%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-soft) 46%, transparent);
  padding: 7px;
}

.ai-agent-timeline-child-marker {
  width: 7px;
  height: 7px;
  margin-top: 5px;
  border-radius: 999px;
  background: var(--text-quaternary);
}

.ai-agent-timeline-child.is-running .ai-agent-timeline-child-marker {
  background: var(--accent-strong);
}

.ai-agent-timeline-child.is-succeeded .ai-agent-timeline-child-marker {
  background: var(--success);
}

.ai-agent-timeline-child.is-failed .ai-agent-timeline-child-marker {
  background: var(--danger);
}

.ai-agent-timeline-child-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.ai-agent-timeline-child-header span {
  flex: 0 0 auto;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 72%, transparent);
  border-radius: 999px;
  color: var(--text-quaternary);
  font-size: 10px;
  line-height: 14px;
  padding: 0 6px;
}

.ai-agent-timeline-child-copy p,
.ai-agent-timeline-empty {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 11px;
  line-height: 16px;
}

.ai-agent-timeline-ref {
  color: var(--text-quaternary);
  overflow-wrap: anywhere;
}

.ai-agent-timeline-empty {
  margin: 0 0 7px;
  padding-left: 4px;
  color: var(--text-quaternary);
}

</style>

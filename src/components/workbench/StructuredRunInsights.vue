<template>
  <div v-if="report.hasContent" class="structured-linear-grid">
    <section class="structured-linear-card structured-linear-card-wide">
      <div class="structured-linear-head">
        <div class="min-w-0">
          <p class="structured-linear-eyebrow">结果反馈</p>
          <h3 class="structured-linear-title truncate">{{ report.result.title }}</h3>
        </div>
        <StatusBadge
          :label="toneLabel(report.result.tone)"
          :tone="toneBadgeTone(report.result.tone)"
        />
      </div>
      <p class="structured-linear-summary">
        {{ report.result.summary }}
      </p>

      <div class="structured-linear-pill-row">
        <span
          v-for="badge in report.result.badges"
          :key="`${badge.label}-${badge.value}`"
          class="structured-linear-pill"
          :class="tonePillClass(badge.tone ?? 'neutral')"
        >
          <span class="structured-linear-pill-label">{{ badge.label }}</span>
          <span>{{ badge.value }}</span>
        </span>
      </div>

      <div v-if="report.result.highlights.length > 0" class="structured-linear-console mt-3">
        <p
          v-for="line in report.result.highlights"
          :key="line"
          class="structured-linear-console-line mono-text"
        >
          {{ line }}
        </p>
      </div>
    </section>

    <section class="structured-linear-card">
      <div class="structured-linear-head">
        <div class="min-w-0">
          <p class="structured-linear-eyebrow">执行过程可视化</p>
          <h3 class="structured-linear-title">步骤流</h3>
        </div>
        <span class="structured-linear-counter">{{ report.steps.length }} 步</span>
      </div>
      <ol class="structured-linear-step-list">
        <li v-for="step in report.steps" :key="step.id" class="structured-linear-step-item">
          <span
            class="structured-linear-step-dot"
            :class="stepToneClass(step.status)"
            aria-hidden="true"
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-3">
              <p class="truncate text-[12px] font-medium text-[var(--text-primary)]">
                {{ step.title }}
              </p>
              <span class="shrink-0 text-[10px] text-[var(--text-quaternary)]">
                {{ step.timestamp }}
              </span>
            </div>
            <p class="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
              {{ step.detail }}
            </p>
          </div>
        </li>
      </ol>
    </section>

    <section class="structured-linear-card">
      <div class="structured-linear-head">
        <div class="min-w-0">
          <p class="structured-linear-eyebrow">异常诊断</p>
          <h3 class="structured-linear-title">{{ report.diagnosis.title }}</h3>
        </div>
        <StatusBadge
          :label="toneLabel(report.diagnosis.tone)"
          :tone="toneBadgeTone(report.diagnosis.tone)"
        />
      </div>

      <p class="structured-linear-summary">
        {{ report.diagnosis.summary }}
      </p>

      <div v-if="report.diagnosis.hints.length > 0" class="structured-linear-hints">
        <p v-for="hint in report.diagnosis.hints" :key="hint" class="structured-linear-hint-line">
          {{ hint }}
        </p>
      </div>

      <div v-if="report.diagnosis.evidence.length > 0" class="structured-linear-console mt-3">
        <p
          v-for="line in report.diagnosis.evidence"
          :key="line"
          class="structured-linear-console-line mono-text"
        >
          {{ line }}
        </p>
      </div>
    </section>

    <section class="structured-linear-card">
      <div class="structured-linear-head">
        <div class="min-w-0">
          <p class="structured-linear-eyebrow">执行摘要</p>
          <h3 class="structured-linear-title">任务汇总</h3>
        </div>
      </div>

      <div class="structured-linear-metrics">
        <div v-for="item in report.summary" :key="item.label" class="structured-linear-metric">
          <p class="structured-linear-metric-label">{{ item.label }}</p>
          <p class="structured-linear-metric-value">{{ item.value }}</p>
        </div>
      </div>
    </section>
  </div>

  <div v-else class="structured-linear-empty">
    <div class="max-w-sm space-y-1.5">
      <p class="text-[13px] font-medium text-[var(--text-primary)]">暂无执行日志</p>
      <p class="text-[12px] leading-5 text-[var(--text-quaternary)]">
        运行脚本后，这里会显示步骤流、状态结论、异常归因和任务汇总。
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import type { IRunLogEntry, IRunResult, TExecutorKind } from '@/types/editor';
import { buildStructuredRunReport } from '@/utils/structured-run-report';

const props = defineProps<{
  terminalOutput: string;
  runLogs: IRunLogEntry[];
  lastRunResult: IRunResult | null;
  isRunning: boolean;
  executor: TExecutorKind;
}>();

const report = computed(() =>
  buildStructuredRunReport({
    terminalOutput: props.terminalOutput,
    runLogs: props.runLogs,
    lastRunResult: props.lastRunResult,
    isRunning: props.isRunning,
    executor: props.executor,
  }),
);

const stepToneClass = (status: 'done' | 'running' | 'warning' | 'error'): string => {
  switch (status) {
    case 'done':
      return 'is-success';
    case 'error':
      return 'is-error';
    case 'warning':
      return 'is-warning';
    default:
      return 'is-running';
  }
};

const tonePillClass = (tone: 'neutral' | 'success' | 'warning' | 'error' | 'running'): string => {
  switch (tone) {
    case 'success':
      return 'is-success';
    case 'warning':
      return 'is-warning';
    case 'error':
      return 'is-error';
    case 'running':
      return 'is-running';
    default:
      return 'is-neutral';
  }
};

const toneLabel = (tone: 'neutral' | 'success' | 'warning' | 'error' | 'running'): string => {
  switch (tone) {
    case 'success':
      return '正常';
    case 'warning':
      return '提醒';
    case 'error':
      return '异常';
    case 'running':
      return '执行中';
    default:
      return '待执行';
  }
};

const toneBadgeTone = (
  tone: 'neutral' | 'success' | 'warning' | 'error' | 'running',
): 'default' | 'success' | 'warning' | 'danger' => {
  switch (tone) {
    case 'success':
      return 'success';
    case 'warning':
      return 'warning';
    case 'error':
      return 'danger';
    case 'running':
      return 'warning';
    default:
      return 'default';
  }
};
</script>

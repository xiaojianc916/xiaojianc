<template>
  <section class="flex h-full min-h-0 flex-col">
    <div class="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
      <div class="flex items-center gap-2">
        <button
          v-for="item in tabs"
          :key="item.value"
          class="rounded-full px-3 py-1.5 text-xs transition"
          :class="
            activeTab === item.value
              ? 'border border-white/10 bg-white/[0.08] text-[var(--text-primary)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
          "
          @click="activeTab = item.value"
        >
          {{ item.label }}
        </button>
      </div>
      <div class="flex items-center gap-3 text-xs text-[var(--text-quaternary)]">
        <span>{{ isRunning ? '正在执行...' : '等待执行' }}</span>
        <span v-if="lastRunResult">
          最近耗时 {{ Math.max(1, Math.round(lastRunResult.durationMs / 100)) / 10 }}s
        </span>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-hidden">
      <div
        v-if="activeTab === 'output'"
        class="h-full overflow-auto px-5 py-4"
      >
        <div class="linear-card-soft h-full min-h-[240px] p-4">
          <pre class="mono-text whitespace-pre-wrap break-words text-[13px] leading-6 text-[var(--text-secondary)]">{{ outputContent }}</pre>
        </div>
      </div>

      <div
        v-else
        class="h-full overflow-auto px-5 py-4"
      >
        <div class="space-y-3">
          <div
            v-for="item in runLogs"
            :key="item.id"
            class="linear-card-soft px-4 py-3"
          >
            <div class="flex items-center justify-between gap-3">
              <p class="text-sm font-medium text-[var(--text-primary)]">{{ item.title }}</p>
              <span class="text-[11px] text-[var(--text-quaternary)]">{{ formatTime(item.createdAt) }}</span>
            </div>
            <p
              class="mt-2 text-sm leading-6"
              :class="logToneClass(item.level)"
            >
              {{ item.detail }}
            </p>
          </div>
          <div
            v-if="runLogs.length === 0"
            class="linear-card-soft px-4 py-8 text-center text-sm text-[var(--text-quaternary)]"
          >
            这里会记录打开、保存、运行与 chmod 等关键操作日志。
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { formatTime } from '@/utils/date';
import type { IRunLogEntry, IRunResult, TLogLevel } from '@/types/editor';

const props = defineProps<{
  terminalOutput: string;
  runLogs: IRunLogEntry[];
  lastRunResult: IRunResult | null;
  isRunning: boolean;
}>();

const activeTab = ref<'output' | 'logs'>('output');

const tabs = [
  { label: '终端输出', value: 'output' },
  { label: '运行日志', value: 'logs' },
] as const;

const outputContent = computed(() => {
  if (props.terminalOutput.trim()) {
    return props.terminalOutput;
  }

  return `# 输出面板已就绪
# 点击右上角“运行脚本”后，可在此查看标准输出、错误输出与完整执行命令。`;
});

const logToneClass = (level: TLogLevel): string => {
  switch (level) {
    case 'success':
      return 'text-emerald-300';
    case 'error':
      return 'text-rose-300';
    default:
      return 'text-[var(--text-secondary)]';
  }
};
</script>

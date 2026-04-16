<template>
  <aside class="flex h-full flex-col gap-6 px-5 py-5">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div
          class="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5"
        >
          <svg
            viewBox="0 0 24 24"
            class="h-4 w-4 text-white"
            fill="none"
          >
            <circle
              cx="12"
              cy="12"
              r="8"
              stroke="currentColor"
              stroke-width="1.4"
              opacity="0.88"
            />
            <path
              d="M8.2 6.8L15.8 17.2"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
          </svg>
        </div>
        <div>
          <p class="text-sm font-medium text-[var(--text-primary)]">SH Editor</p>
          <p class="text-xs text-[var(--text-quaternary)]">脚本工作台</p>
        </div>
      </div>
      <span class="linear-pill text-[11px]">专注编写</span>
    </div>

    <nav class="space-y-1">
      <button
        v-for="item in navItems"
        :key="item.label"
        class="flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition"
        :class="
          item.active
            ? 'border-white/10 bg-white/[0.06] text-[var(--text-primary)]'
            : 'border-transparent bg-transparent text-[var(--text-tertiary)] hover:border-white/5 hover:bg-white/[0.04] hover:text-[var(--text-secondary)]'
        "
      >
        <span
          class="flex h-7 w-7 items-center justify-center rounded-lg"
          :class="item.active ? 'bg-white/[0.08]' : 'bg-white/[0.04]'"
        >
          {{ item.icon }}
        </span>
        <span class="text-[15px] font-medium">{{ item.label }}</span>
      </button>
    </nav>

    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-xs uppercase tracking-[0.18em] text-[var(--text-quaternary)]">工作区</p>
        <span class="text-xs text-[var(--text-quaternary)]">当前脚本</span>
      </div>
      <div class="linear-card-soft space-y-3 p-4">
        <div>
          <p class="truncate text-sm font-medium text-[var(--text-primary)]">{{ document.name }}</p>
          <p class="mt-1 text-xs text-[var(--text-quaternary)]">
            {{ document.path ?? '尚未保存到本地文件' }}
          </p>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="rounded-xl border border-white/5 bg-white/[0.04] px-3 py-2">
            <p class="text-[11px] uppercase tracking-[0.12em] text-[var(--text-quaternary)]">
              行数
            </p>
            <p class="mt-1 text-lg font-medium text-[var(--text-primary)]">{{ document.lineCount }}</p>
          </div>
          <div class="rounded-xl border border-white/5 bg-white/[0.04] px-3 py-2">
            <p class="text-[11px] uppercase tracking-[0.12em] text-[var(--text-quaternary)]">
              字符
            </p>
            <p class="mt-1 text-lg font-medium text-[var(--text-primary)]">{{ document.charCount }}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-xs uppercase tracking-[0.18em] text-[var(--text-quaternary)]">状态概览</p>
      </div>
      <div class="linear-card-soft space-y-3 p-4 text-sm">
        <div class="flex items-center justify-between">
          <span class="text-[var(--text-tertiary)]">编辑状态</span>
          <span class="text-[var(--text-primary)]">{{ document.isDirty ? '待保存' : '已同步' }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-[var(--text-tertiary)]">输出面板</span>
          <span class="text-[var(--text-primary)]">{{ hasTerminalOutput ? '有输出' : '待执行' }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-[var(--text-tertiary)]">日志条数</span>
          <span class="text-[var(--text-primary)]">{{ logsCount }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-[var(--text-tertiary)]">运行状态</span>
          <span :class="isRunning ? 'text-emerald-300' : 'text-[var(--text-secondary)]'">
            {{ isRunning ? '执行中' : '空闲' }}
          </span>
        </div>
      </div>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { IEditorDocument } from '@/types/editor';

defineProps<{
  document: IEditorDocument;
  logsCount: number;
  hasTerminalOutput: boolean;
  isRunning: boolean;
}>();

const navItems = computed(() => [
  { label: '脚本编写', icon: '⌘', active: true },
  { label: '运行调试', icon: '▶', active: false },
  { label: '命令模板', icon: '#', active: false },
  { label: '执行记录', icon: '◎', active: false },
]);
</script>

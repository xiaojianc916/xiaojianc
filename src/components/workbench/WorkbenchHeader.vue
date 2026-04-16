<template>
  <header class="flex flex-col gap-4 border-b border-white/[0.06] px-6 py-5">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="space-y-2">
        <div class="flex items-center gap-2">
          <StatusBadge
            :label="isDirty ? '草稿已变更' : '已保存'"
            :tone="isDirty ? 'warning' : 'success'"
          />
          <StatusBadge
            :label="environmentStatusLabel"
            :tone="environmentStatusTone"
          />
        </div>
        <div>
          <h1 class="text-[30px] font-medium tracking-[-0.04em] text-[var(--text-primary)]">
            {{ title }}
          </h1>
          <p class="mt-1 text-sm text-[var(--text-tertiary)]">
            编码 {{ encoding.toUpperCase() }} · 执行器 {{ executorLabel }}
          </p>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          class="linear-button px-4 py-2 text-sm"
          @click="$emit('new')"
        >
          新建
        </button>
        <button
          class="linear-button px-4 py-2 text-sm"
          :disabled="!isDesktopRuntime"
          @click="$emit('open')"
        >
          打开
        </button>
        <button
          class="linear-button px-4 py-2 text-sm"
          :disabled="!isDesktopRuntime"
          @click="$emit('save')"
        >
          保存
        </button>
        <button
          class="linear-button px-4 py-2 text-sm"
          :disabled="!isDesktopRuntime"
          @click="$emit('save-as')"
        >
          另存为
        </button>
        <button
          class="linear-button px-4 py-2 text-sm"
          :disabled="!isDesktopRuntime"
          @click="$emit('chmod')"
        >
          chmod +x
        </button>
        <button
          class="linear-button linear-button-primary flex items-center gap-2 px-4 py-2 text-sm"
          :disabled="isRunning || !isDesktopRuntime"
          @click="$emit('run')"
        >
          <span>{{ isRunning ? '执行中...' : '运行脚本' }}</span>
        </button>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import type { TDocumentEncoding, TExecutorKind } from '@/types/editor';

const props = defineProps<{
  title: string;
  isDirty: boolean;
  encoding: TDocumentEncoding;
  executor: TExecutorKind;
  hasEnvironment: boolean;
  isDesktopRuntime: boolean;
  isRunning: boolean;
}>();

defineEmits<{
  new: [];
  open: [];
  save: [];
  'save-as': [];
  run: [];
  chmod: [];
}>();

const executorLabel = computed(() => {
  switch (props.executor) {
    case 'wsl':
      return 'WSL';
    case 'git-bash':
      return 'Git Bash / sh';
    case 'bash':
      return 'Windows Bash';
    default:
      return '自动选择';
  }
});

const environmentStatusLabel = computed(() => {
  if (!props.isDesktopRuntime) {
    return '浏览器预览模式';
  }

  return props.hasEnvironment ? '可执行环境已就绪' : '未检测到执行环境';
});

const environmentStatusTone = computed(() => {
  if (!props.isDesktopRuntime) {
    return 'warning';
  }

  return props.hasEnvironment ? 'success' : 'danger';
});
</script>

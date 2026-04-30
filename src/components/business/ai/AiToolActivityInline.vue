<script setup lang="ts">
import { computed } from 'vue';

import type { IAiToolCall } from '@/types/ai';

const props = defineProps<{
  toolCalls: IAiToolCall[];
}>();

const TOOL_NAME_LABELS: Record<string, string> = {
  read_current_file: '当前文件',
  read_selected_text: '当前选区',
  search_files: '文件名',
  search_text: '项目内容',
  search_symbols: '符号',
  get_diagnostics: '诊断',
  get_git_diff: 'Git 变更',
  get_terminal_log: '终端日志',
  web_search: '网页',
  web_fetch: '网页',
  propose_patch: 'Patch',
  auto_apply_patch: 'Patch',
  run_test: '测试',
  run_command: '命令',
  stage_file: 'Git 暂存',
  create_commit: 'Git 提交',
};

const getBaseLabel = (toolCall: IAiToolCall): string => {
  const summary = toolCall.summary.trim();
  if (summary) {
    return summary;
  }

  return TOOL_NAME_LABELS[toolCall.name] ?? toolCall.name;
};

const getRunningLabel = (toolCall: IAiToolCall): string => {
  const baseLabel = getBaseLabel(toolCall);

  switch (toolCall.name) {
    case 'web_search':
      return `正在搜索网页: ${baseLabel}…`;
    case 'web_fetch':
      return `正在加载网页: ${baseLabel}…`;
    case 'search_files':
    case 'search_text':
    case 'search_symbols':
      return `正在搜索：${baseLabel}…`;
    case 'read_current_file':
    case 'read_selected_text':
    case 'get_diagnostics':
    case 'get_git_diff':
    case 'get_terminal_log':
      return `正在读取：${baseLabel}…`;
    case 'propose_patch':
    case 'auto_apply_patch':
      return `正在应用：${baseLabel}…`;
    case 'run_test':
      return `正在验证：${baseLabel}…`;
    case 'run_command':
      return `正在执行：${baseLabel}…`;
    default:
      return `正在使用 ${toolCall.name}…`;
  }
};

const getSucceededLabel = (toolCall: IAiToolCall): string => {
  const baseLabel = getBaseLabel(toolCall);

  switch (toolCall.name) {
    case 'web_search':
      return '已搜索网页';
    case 'web_fetch':
      return `已加载网页: ${baseLabel}`;
    case 'search_files':
    case 'search_text':
    case 'search_symbols':
      return `已搜索：${baseLabel}`;
    case 'read_current_file':
    case 'read_selected_text':
    case 'get_diagnostics':
    case 'get_git_diff':
    case 'get_terminal_log':
      return `已读取：${baseLabel}`;
    case 'propose_patch':
    case 'auto_apply_patch':
      return `已应用：${baseLabel}`;
    case 'run_test':
      return `已验证：${baseLabel}`;
    case 'run_command':
      return `已执行：${baseLabel}`;
    default:
      return `已使用 ${toolCall.name}`;
  }
};

const getStatusLabel = (toolCall: IAiToolCall): string => {
  switch (toolCall.status) {
    case 'pending':
      return `等待使用：${getBaseLabel(toolCall)}`;
    case 'running':
      return getRunningLabel(toolCall);
    case 'succeeded':
      return getSucceededLabel(toolCall);
    case 'failed':
      return `调用失败：${getBaseLabel(toolCall)}`;
    case 'denied':
      return `已拒绝：${getBaseLabel(toolCall)}`;
    default:
      return getBaseLabel(toolCall);
  }
};

const items = computed(() =>
  props.toolCalls.map((toolCall) => ({
    ...toolCall,
    label: getStatusLabel(toolCall),
  })),
);
</script>

<template>
  <section v-if="items.length" class="ai-tool-activity-inline" aria-label="工具调用活动">
    <ol class="ai-tool-activity-list">
      <li v-for="item in items" :key="item.id" class="ai-tool-activity-item" :class="`is-${item.status}`">
        <span class="ai-tool-activity-rail" aria-hidden="true">
          <span v-if="item.status === 'running'" class="ai-tool-running-dots">
            <span></span>
            <span></span>
            <span></span>
          </span>
          <span v-else class="ai-tool-dot"></span>
        </span>
        <span class="ai-tool-activity-label">{{ item.label }}</span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.ai-tool-activity-inline {
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.ai-tool-activity-list {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ai-tool-activity-item {
  position: relative;
  display: grid;
  min-width: 0;
  grid-template-columns: 24px minmax(0, 1fr);
  column-gap: 4px;
  color: var(--text-tertiary);
}

.ai-tool-activity-item::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 5px;
  width: 1px;
  background: color-mix(in srgb, var(--shell-divider) 76%, transparent);
  content: '';
}

.ai-tool-activity-item:first-child::before {
  top: 9px;
}

.ai-tool-activity-item:last-child::before {
  bottom: calc(100% - 9px);
}

.ai-tool-activity-item:only-child::before {
  display: none;
}

.ai-tool-activity-rail {
  position: relative;
  z-index: 1;
  display: flex;
  width: 11px;
  min-height: 32px;
  align-items: flex-start;
  justify-content: center;
  padding-top: 7px;
}

.ai-tool-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-quaternary) 54%, transparent);
}

.ai-tool-running-dots {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding-top: 1px;
}

.ai-tool-running-dots span {
  width: 4px;
  height: 4px;
  border-radius: 999px;
  animation: ai-tool-dot-pulse 1.05s infinite ease-in-out;
  background: var(--text-tertiary);
}

.ai-tool-running-dots span:nth-child(2) {
  animation-delay: 120ms;
}

.ai-tool-running-dots span:nth-child(3) {
  animation-delay: 240ms;
}

.ai-tool-activity-label {
  min-width: 0;
  padding: 2px 0 12px;
  color: inherit;
  overflow-wrap: anywhere;
  word-break: normal;
}

.ai-tool-activity-item.is-running {
  color: var(--text-secondary);
}

.ai-tool-activity-item.is-failed {
  color: var(--danger);
}

.ai-tool-activity-item.is-denied,
.ai-tool-activity-item.is-pending {
  color: var(--text-quaternary);
}

@keyframes ai-tool-dot-pulse {
  0%,
  80%,
  100% {
    opacity: 0.32;
    transform: scale(0.86);
  }

  40% {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ai-tool-running-dots span {
    animation: none;
  }
}
</style>

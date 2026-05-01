<script setup lang="ts">
import {
  Activity,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileText,
  FolderTree,
  GitBranch,
  Globe,
  LoaderCircle,
  Pencil,
  Search,
  Terminal,
  XCircle,
} from 'lucide-vue-next';
import { computed } from 'vue';
import type { Component } from 'vue';

import type { IAiToolCall } from '@/types/ai';

const props = defineProps<{
  toolCalls: IAiToolCall[];
}>();

type TToolActionKind =
  | 'read'
  | 'search'
  | 'diagnose'
  | 'patch'
  | 'applyPatch'
  | 'execute'
  | 'verify'
  | 'git'
  | 'web'
  | 'tree'
  | 'unknown';

interface IToolActionMeta {
  verb: string;
  completedVerb: string;
  fallbackTarget: string;
  icon: Component;
}

interface IToolStatusMeta {
  label: string;
  detail: string;
  icon: Component;
}

interface IToolTimelineItem extends IAiToolCall {
  headline: string;
  statusLabel: string;
  detailRows: string[];
  chips: string[];
  lineRange: string | null;
  toolIcon: Component;
  statusIcon: Component;
  isSpinning: boolean;
  isOpen: boolean;
}

const TOOL_ACTION_BY_NAME: Record<string, TToolActionKind> = {
  read_current_file: 'read',
  read_selected_text: 'read',
  read_file: 'read',
  read_project_file: 'read',
  list_open_files: 'read',
  list_project_files: 'tree',
  get_package_scripts: 'read',
  get_test_targets: 'read',
  get_terminal_log: 'read',
  search_files: 'search',
  search_text: 'search',
  search_symbols: 'search',
  search_project_files: 'search',
  get_diagnostics: 'diagnose',
  get_git_diff: 'git',
  get_project_tree: 'tree',
  web_search: 'web',
  web_fetch: 'web',
  propose_patch: 'patch',
  auto_apply_patch: 'applyPatch',
  write_file: 'applyPatch',
  delete_file: 'execute',
  run_test: 'verify',
  run_command: 'execute',
  run_shell_command: 'execute',
  install_package: 'execute',
  stage_file: 'git',
  create_commit: 'git',
  git_commit: 'git',
};

const TOOL_ACTION_META: Record<TToolActionKind, IToolActionMeta> = {
  read: {
    verb: '读取',
    completedVerb: '读取完成',
    fallbackTarget: '文件',
    icon: FileText,
  },
  search: {
    verb: '搜索',
    completedVerb: '搜索完成',
    fallbackTarget: '项目',
    icon: Search,
  },
  diagnose: {
    verb: '检查',
    completedVerb: '检查完成',
    fallbackTarget: '工作区',
    icon: Activity,
  },
  patch: {
    verb: '生成 Patch',
    completedVerb: 'Patch 已生成',
    fallbackTarget: '变更',
    icon: Pencil,
  },
  applyPatch: {
    verb: '应用 Patch',
    completedVerb: 'Patch 已应用',
    fallbackTarget: '变更',
    icon: Pencil,
  },
  execute: {
    verb: '执行',
    completedVerb: '执行完成',
    fallbackTarget: '命令',
    icon: Terminal,
  },
  verify: {
    verb: '验证',
    completedVerb: '验证完成',
    fallbackTarget: '测试',
    icon: Terminal,
  },
  git: {
    verb: '查看 Git',
    completedVerb: 'Git 操作完成',
    fallbackTarget: '变更',
    icon: GitBranch,
  },
  web: {
    verb: '获取网页',
    completedVerb: '网页获取完成',
    fallbackTarget: '资源',
    icon: Globe,
  },
  tree: {
    verb: '读取目录',
    completedVerb: '目录读取完成',
    fallbackTarget: '项目结构',
    icon: FolderTree,
  },
  unknown: {
    verb: '调用工具',
    completedVerb: '工具调用完成',
    fallbackTarget: '任务',
    icon: Activity,
  },
};

const TOOL_STATUS_META: Record<IAiToolCall['status'], IToolStatusMeta> = {
  pending: {
    label: '等待中',
    detail: '等待工具确认',
    icon: Clock3,
  },
  running: {
    label: '运行中',
    detail: '工具正在执行',
    icon: LoaderCircle,
  },
  succeeded: {
    label: '已完成',
    detail: '工具返回成功结果',
    icon: CheckCircle2,
  },
  failed: {
    label: '失败',
    detail: '工具执行失败',
    icon: CircleAlert,
  },
  denied: {
    label: '已停止',
    detail: '工具调用已停止',
    icon: XCircle,
  },
};

const STATUS_PREFIX_PATTERN =
  /^(?:正在|已|等待|调用失败|已拒绝|Agent\s*)\s*(?:读取|搜索|加载|使用|应用|生成|验证|执行|运行|检索|分析|暂存|提交|调用|完成)?\s*[:：]?\s*/u;

const GENERIC_TARGET_PREFIX_PATTERN =
  /^(?:当前文件|当前选区|项目内容|文件名|符号|诊断|Git\s*变更|终端日志|网页|Patch|测试|命令|Git\s*暂存|Git\s*提交|文件|打开文件|package scripts|测试目标|工作区)\s*[:：]?\s*/iu;

const getActionKind = (toolName: string): TToolActionKind =>
  TOOL_ACTION_BY_NAME[toolName] ?? 'unknown';

const normalizeText = (value: string): string =>
  value
    .replace(/…$/u, '')
    .replace(/\s+/gu, ' ')
    .trim();

const stripTargetNoise = (value: string): string => {
  const withoutStatus = normalizeText(value).replace(STATUS_PREFIX_PATTERN, '').trim();
  const withoutGenericPrefix = withoutStatus.replace(GENERIC_TARGET_PREFIX_PATTERN, '').trim();

  return withoutGenericPrefix || withoutStatus;
};

const isUrlLike = (value: string): boolean => /^https?:\/\//iu.test(value);

const isFileLikeTarget = (value: string): boolean =>
  /[\\/]/u.test(value) || /\.[a-z0-9]{1,12}(?::|#L|\s*$)/iu.test(value);

const formatLineRange = (start: string, end: string | undefined): string =>
  end && end !== start ? `L${start}-${end}` : `L${start}`;

const parseTarget = (value: string): { target: string; lineRange: string | null } => {
  const target = normalizeText(value);

  if (!target || isUrlLike(target)) {
    return {
      target,
      lineRange: null,
    };
  }

  const hashLineMatch = target.match(/^(.+?)#L(\d+)(?:-L?(\d+))?$/u);
  if (hashLineMatch?.[1] && hashLineMatch[2] && isFileLikeTarget(hashLineMatch[1])) {
    return {
      target: hashLineMatch[1].trim(),
      lineRange: formatLineRange(hashLineMatch[2], hashLineMatch[3]),
    };
  }

  const colonLineMatch = target.match(/^(.+):(\d+)(?:-(\d+))?$/u);
  if (colonLineMatch?.[1] && colonLineMatch[2] && isFileLikeTarget(colonLineMatch[1])) {
    return {
      target: colonLineMatch[1].trim(),
      lineRange: formatLineRange(colonLineMatch[2], colonLineMatch[3]),
    };
  }

  return {
    target,
    lineRange: null,
  };
};

const getPreviewSource = (toolCall: IAiToolCall, fallbackTarget: string): string =>
  toolCall.targetPreview?.trim() || toolCall.summary.trim() || fallbackTarget;

const formatElapsed = (elapsedMs: number | undefined): string | null => {
  if (elapsedMs === undefined) {
    return null;
  }

  if (elapsedMs < 1000) {
    return `${elapsedMs}ms`;
  }

  return `${Math.max(1, Math.round(elapsedMs / 1000))}s`;
};

const uniqueStrings = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);
    return true;
  });
};

const buildTimelineItem = (toolCall: IAiToolCall): IToolTimelineItem => {
  const actionMeta = TOOL_ACTION_META[getActionKind(toolCall.name)];
  const statusMeta = TOOL_STATUS_META[toolCall.status];
  const parsedTarget = parseTarget(stripTargetNoise(getPreviewSource(toolCall, actionMeta.fallbackTarget)));
  const target = parsedTarget.target || actionMeta.fallbackTarget;
  const elapsed = formatElapsed(toolCall.elapsedMs);
  const headline = `${toolCall.status === 'succeeded' ? actionMeta.completedVerb : actionMeta.verb} ${target}`;
  const detailRows = uniqueStrings([
    elapsed ? `${statusMeta.detail}，耗时 ${elapsed}` : statusMeta.detail,
    normalizeText(toolCall.summary),
  ]);
  const chips = uniqueStrings([
    target,
    parsedTarget.lineRange ?? '',
  ]);

  return {
    ...toolCall,
    headline,
    statusLabel: statusMeta.label,
    detailRows,
    chips,
    lineRange: parsedTarget.lineRange,
    toolIcon: actionMeta.icon,
    statusIcon: statusMeta.icon,
    isSpinning: toolCall.status === 'running',
    isOpen: false,
  };
};

const items = computed(() => props.toolCalls.map(buildTimelineItem));
</script>

<template>
  <section
    v-if="items.length"
    class="ai-tool-activity-inline ai-tool-run-timeline"
    aria-label="工具调用时间线"
  >
    <ol class="ai-tool-run-list">
      <li
        v-for="item in items"
        :key="item.id"
        class="ai-tool-run-item"
        :class="`is-${item.status}`"
      >
        <span class="ai-tool-run-rail" aria-hidden="true">
          <component
            :is="item.statusIcon"
            class="ai-tool-status-icon"
            :class="{ 'is-spinning': item.isSpinning }"
          />
        </span>
        <details class="ai-tool-run-details" :open="item.isOpen">
          <summary class="ai-tool-run-summary">
            <component :is="item.toolIcon" class="ai-tool-kind-icon" aria-hidden="true" />
            <span class="ai-tool-run-title" :title="item.headline">{{ item.headline }}</span>
            <span class="ai-tool-run-status">{{ item.statusLabel }}</span>
            <ChevronRight class="ai-tool-run-chevron" aria-hidden="true" />
          </summary>
          <div class="ai-tool-run-children">
            <div
              v-for="row in item.detailRows"
              :key="`${item.id}:${row}`"
              class="ai-tool-run-substep"
            >
              <span class="ai-tool-run-dot" aria-hidden="true" />
              <span>{{ row }}</span>
            </div>
            <div v-if="item.chips.length" class="ai-tool-run-chips">
              <span
                v-for="chip in item.chips"
                :key="`${item.id}:${chip}`"
                class="ai-tool-run-chip"
                :title="chip"
              >
                {{ chip }}
              </span>
            </div>
          </div>
        </details>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.ai-tool-run-timeline {
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.ai-tool-run-list {
  display: grid;
  gap: 1px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ai-tool-run-item {
  position: relative;
  display: grid;
  min-width: 0;
  grid-template-columns: 18px minmax(0, 1fr);
  column-gap: 7px;
}

.ai-tool-run-item::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 8px;
  width: 1px;
  background: color-mix(in srgb, var(--shell-divider) 72%, transparent);
  content: '';
}

.ai-tool-run-item:first-child::before {
  top: 15px;
}

.ai-tool-run-item:last-child::before {
  bottom: calc(100% - 15px);
}

.ai-tool-run-item:only-child::before {
  display: none;
}

.ai-tool-run-rail {
  position: relative;
  z-index: 1;
  display: flex;
  min-height: 31px;
  align-items: flex-start;
  justify-content: center;
  padding-top: 9px;
}

.ai-tool-status-icon {
  width: 13px;
  height: 13px;
  border-radius: 999px;
  background: var(--surface-base);
  color: var(--text-quaternary);
  stroke-width: 2;
}

.ai-tool-status-icon.is-spinning {
  animation: ai-tool-status-spin 900ms linear infinite;
  color: var(--text-secondary);
}

.ai-tool-run-details {
  min-width: 0;
}

.ai-tool-run-summary {
  display: grid;
  min-width: 0;
  min-height: 31px;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 6px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: default;
  list-style: none;
  padding: 4px 6px;
  transition:
    background-color 150ms cubic-bezier(0.23, 1, 0.32, 1),
    color 150ms cubic-bezier(0.23, 1, 0.32, 1);
}

.ai-tool-run-summary::-webkit-details-marker {
  display: none;
}

.ai-tool-kind-icon {
  width: 13px;
  height: 13px;
  color: var(--text-quaternary);
  stroke-width: 1.9;
}

.ai-tool-run-title {
  min-width: 0;
  overflow: hidden;
  color: inherit;
  font-weight: 500;
  text-overflow: ellipsis;
  unicode-bidi: plaintext;
  white-space: nowrap;
}

.ai-tool-run-status {
  color: var(--text-quaternary);
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
}

.ai-tool-run-chevron {
  width: 12px;
  height: 12px;
  color: var(--text-quaternary);
  stroke-width: 2;
  transition: transform 150ms cubic-bezier(0.23, 1, 0.32, 1);
}

.ai-tool-run-details[open] .ai-tool-run-chevron {
  transform: rotate(90deg);
}

.ai-tool-run-children {
  display: grid;
  gap: 5px;
  padding: 1px 6px 8px 12px;
}

.ai-tool-run-substep {
  display: grid;
  min-width: 0;
  grid-template-columns: 7px minmax(0, 1fr);
  align-items: baseline;
  column-gap: 8px;
  color: var(--text-tertiary);
}

.ai-tool-run-dot {
  width: 3px;
  height: 3px;
  border-radius: 999px;
  background: var(--text-quaternary);
}

.ai-tool-run-chips {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 5px;
  padding-left: 15px;
}

.ai-tool-run-chip {
  max-width: 100%;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 74%, transparent);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--surface-soft) 76%, transparent);
  color: var(--text-secondary);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 11px;
  line-height: 16px;
  padding: 1px 6px;
  text-overflow: ellipsis;
  unicode-bidi: plaintext;
  white-space: nowrap;
}

.ai-tool-run-item.is-running .ai-tool-run-summary {
  background: color-mix(in srgb, var(--surface-soft) 62%, transparent);
  color: var(--text-primary);
}

.ai-tool-run-item.is-succeeded .ai-tool-status-icon {
  color: var(--success);
}

.ai-tool-run-item.is-failed .ai-tool-status-icon,
.ai-tool-run-item.is-failed .ai-tool-run-status {
  color: var(--danger);
}

.ai-tool-run-item.is-denied,
.ai-tool-run-item.is-pending {
  color: var(--text-quaternary);
}

.ai-tool-run-item.is-denied .ai-tool-status-icon {
  color: var(--text-quaternary);
}

@media (hover: hover) and (pointer: fine) {
  .ai-tool-run-summary:hover {
    background: color-mix(in srgb, var(--surface-hover) 74%, transparent);
    color: var(--text-primary);
  }
}

@keyframes ai-tool-status-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ai-tool-status-icon.is-spinning,
  .ai-tool-run-chevron {
    animation: none;
    transition: none;
  }
}
</style>

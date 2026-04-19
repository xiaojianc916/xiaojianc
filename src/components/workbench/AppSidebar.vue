<template>
  <aside class="flex h-full min-h-0 flex-col overflow-hidden">
    <div class="border-b border-(--shell-divider) px-3 py-3">
      <p class="sidebar-section-title">{{ panelMeta.title }}</p>
    </div>

    <div class="workbench-scroll-region min-h-0 flex-1 overflow-auto py-2">
      <template v-if="isExplorerView">
        <div v-if="!isDesktopRuntime" class="explorer-helper-text px-3 py-2">
          浏览器预览模式下不显示本地目录树，请在 Tauri 桌面端查看资源文件。
        </div>

        <template v-else-if="root">
          <button
            type="button"
            class="explorer-root-row w-full text-left"
            :class="{ 'is-expanded': rootExpanded }"
            @click="toggleRoot"
          >
            <span class="explorer-chevron">
              <svg
                viewBox="0 0 12 12"
                class="h-3 w-3 transition-transform"
                :class="rootExpanded ? 'rotate-90' : ''"
                fill="none"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M4 2.5 8 6 4 9.5" />
              </svg>
            </span>
            <FileEntryIcon
              kind="directory"
              :path="root.rootPath"
              :expanded="rootExpanded"
              class="h-4 w-4 shrink-0"
            />
            <span class="truncate">{{ rootLabel }}</span>
          </button>

          <div v-if="rootExpanded" class="pb-2">
            <div v-if="rootLoading" class="explorer-helper-text px-3 py-2">正在读取资源目录...</div>
            <div v-else-if="rootEntries.length === 0" class="explorer-helper-text px-3 py-2">
              当前目录暂无文件。
            </div>
            <WorkspaceTreeNode
              v-for="entry in rootEntries"
              :key="entry.path"
              :entry="entry"
              :level="0"
              :children-map="childrenMap"
              :expanded-paths="expandedPaths"
              :loading-paths="loadingPaths"
              :active-path="document.path"
              :active-dirty="document.isDirty"
              @toggle-directory="toggleDirectory"
              @open-file="handleOpenFile"
            />
          </div>
        </template>

        <div v-else-if="rootLoading" class="explorer-helper-text px-3 py-2">
          正在读取资源目录...
        </div>
        <div v-else-if="loadError" class="explorer-helper-text px-3 py-2">{{ loadError }}</div>
        <div v-else class="h-full" />
      </template>

      <div v-else class="space-y-3 px-3 py-2">
        <section class="rounded-xl border border-(--border-subtle) bg-white/3 p-3">
          <p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-(--text-quaternary)">
            侧边栏页面
          </p>
          <h3 class="mt-2 text-[13px] font-semibold text-(--text-primary)">
            {{ panelMeta.headline }}
          </h3>
          <p class="mt-2 text-[12px] leading-6 text-(--text-secondary)">
            {{ panelMeta.description }}
          </p>
          <div class="mt-3 flex items-center gap-2">
            <Button variant="outline" size="sm">{{ panelMeta.actionLabel }}</Button>
            <span class="text-[11px] text-(--text-quaternary)">交互面板预留位</span>
          </div>
        </section>

        <section class="rounded-xl border border-(--border-subtle) bg-(--panel-muted)/50 p-3">
          <p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-(--text-quaternary)">
            将展示
          </p>
          <div class="mt-3 space-y-2">
            <article
              v-for="item in panelMeta.items"
              :key="item.title"
              class="rounded-lg border border-white/5 bg-white/3 px-3 py-2"
            >
              <p class="text-[12px] font-medium text-(--text-primary)">{{ item.title }}</p>
              <p class="mt-1 text-[11px] leading-5 text-(--text-secondary)">
                {{ item.description }}
              </p>
            </article>
          </div>
        </section>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import FileEntryIcon from '@/components/common/FileEntryIcon.vue';
import { Button } from '@/components/ui/button';
import WorkspaceTreeNode from '@/components/workbench/WorkspaceTreeNode.vue';
import { useMessage } from '@/composables/useMessage';
import { tauriService } from '@/services/tauri';
import type { TWorkbenchSidebarView } from '@/types/app';
import type { IEditorDocument, IWorkspaceDirectoryPayload, IWorkspaceEntry } from '@/types/editor';
import { computed, reactive, ref, watch } from 'vue';

const props = defineProps<{
  document: IEditorDocument;
  view: TWorkbenchSidebarView;
  isDesktopRuntime: boolean;
  workspaceRootPath: string | null;
  preloadedWorkspaceRoot: IWorkspaceDirectoryPayload | null;
}>();

const emit = defineEmits<{
  'open-file': [path: string];
}>();

const root = ref<IWorkspaceDirectoryPayload | null>(null);
const rootExpanded = ref(true);
const rootLoading = ref(false);
const loadError = ref('');
const childrenMap = reactive<Record<string, IWorkspaceEntry[]>>({});
const expandedPaths = reactive<Record<string, boolean>>({});
const loadingPaths = reactive<Record<string, boolean>>({});
const loadedWorkspaceKey = ref<string | null>(null);
let rootRequestId = 0;

const SIDEBAR_META: Record<
  TWorkbenchSidebarView,
  {
    title: string;
    headline: string;
    description: string;
    actionLabel: string;
    items: Array<{ title: string; description: string }>;
  }
> = {
  explorer: {
    title: '资源管理器',
    headline: '浏览工作区目录',
    description: '在这里查看脚本、图片资源和文件树。',
    actionLabel: '浏览文件',
    items: [],
  },
  search: {
    title: '搜索',
    headline: '全局搜索与快速定位',
    description: '后续可以在这里放置关键字、范围过滤和搜索结果列表。',
    actionLabel: '搜索面板',
    items: [
      { title: '全文匹配', description: '跨脚本搜索命令、变量、路径和注释。' },
      { title: '范围过滤', description: '限定目录、文件类型和忽略规则。' },
      { title: '结果联动', description: '搜索结果可直接定位到编辑器标签。' },
    ],
  },
  'source-control': {
    title: '源代码管理',
    headline: '变更、暂存与提交',
    description: '后续可以在这里聚合当前工作区的 Git 状态与常用操作。',
    actionLabel: '版本控制',
    items: [
      { title: '变更列表', description: '按文件展示未提交、已暂存和冲突状态。' },
      { title: '提交入口', description: '输入提交说明并触发常用 Git 动作。' },
      { title: '分支提示', description: '显示当前分支和同步状态。' },
    ],
  },
  run: {
    title: '运行',
    headline: '执行配置与流程入口',
    description: '后续可以把运行配置、快速命令和运行历史收拢到这一栏。',
    actionLabel: '运行配置',
    items: [
      { title: '启动脚本', description: '预置常用执行模板和参数组合。' },
      { title: '调试入口', description: '为脚本运行和终端回放留出调试位。' },
      { title: '历史记录', description: '回看最近一次运行的命令和结果。' },
    ],
  },
  extensions: {
    title: '扩展',
    headline: '能力扩展与工作流插件',
    description: '后续可以把扩展推荐、已启用能力和集成入口都集中到这里。',
    actionLabel: '扩展中心',
    items: [
      { title: '扩展建议', description: '根据当前工作流推荐合适的工具能力。' },
      { title: '已启用项', description: '管理可选增强特性和集成面板。' },
      { title: '能力说明', description: '展示每个扩展页能做什么以及如何使用。' },
    ],
  },
};

const isExplorerView = computed(() => props.view === 'explorer');
const panelMeta = computed(() => SIDEBAR_META[props.view]);

const rootEntries = computed(() => {
  if (!root.value) {
    return [];
  }

  return childrenMap[root.value.rootPath] ?? [];
});

const rootLabel = computed(() => root.value?.rootName ?? 'workspace');

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const clearTreeState = (): void => {
  Object.keys(childrenMap).forEach((path) => {
    delete childrenMap[path];
  });
  Object.keys(expandedPaths).forEach((path) => {
    delete expandedPaths[path];
  });
  Object.keys(loadingPaths).forEach((path) => {
    delete loadingPaths[path];
  });
};

const applyWorkspaceRootPayload = (
  payload: IWorkspaceDirectoryPayload,
  workspaceKey: string,
): void => {
  rootRequestId += 1;
  rootLoading.value = false;
  loadError.value = '';
  root.value = payload;
  loadedWorkspaceKey.value = workspaceKey;
  clearTreeState();
  childrenMap[payload.rootPath] = payload.entries;
  rootExpanded.value = true;
};

const resolvePreloadedWorkspaceRoot = (): IWorkspaceDirectoryPayload | null => {
  if (!props.workspaceRootPath || !props.preloadedWorkspaceRoot) {
    return null;
  }

  return props.preloadedWorkspaceRoot.rootPath === props.workspaceRootPath
    ? props.preloadedWorkspaceRoot
    : null;
};

const loadWorkspaceRoot = async (workspaceKey: string): Promise<void> => {
  if (!props.isDesktopRuntime) {
    return;
  }

  if (!props.workspaceRootPath) {
    rootLoading.value = false;
    loadError.value = '';
    root.value = null;
    loadedWorkspaceKey.value = null;
    clearTreeState();
    return;
  }

  const preloadedWorkspaceRoot = resolvePreloadedWorkspaceRoot();
  if (preloadedWorkspaceRoot) {
    applyWorkspaceRootPayload(preloadedWorkspaceRoot, workspaceKey);
    return;
  }

  const requestId = rootRequestId + 1;
  rootRequestId = requestId;
  rootLoading.value = true;
  loadError.value = '';
  root.value = null;
  loadedWorkspaceKey.value = null;
  clearTreeState();

  try {
    const payload = await tauriService.listWorkspaceEntries(undefined, props.workspaceRootPath);
    if (requestId !== rootRequestId) {
      return;
    }

    applyWorkspaceRootPayload(payload, workspaceKey);
  } catch (error) {
    if (requestId !== rootRequestId) {
      return;
    }

    root.value = null;
    loadedWorkspaceKey.value = null;
    loadError.value = getErrorMessage(error, '读取工作区目录失败');
  } finally {
    if (requestId === rootRequestId) {
      rootLoading.value = false;
    }
  }
};

const loadDirectoryEntries = async (path: string): Promise<void> => {
  if (loadingPaths[path]) {
    return;
  }

  loadingPaths[path] = true;

  try {
    const payload = await tauriService.listWorkspaceEntries(path, root.value?.rootPath);
    childrenMap[path] = payload.entries;
  } catch (error) {
    const message = getErrorMessage(error, '读取目录失败');
    useMessage().error(message);
    childrenMap[path] = [];
  } finally {
    loadingPaths[path] = false;
  }
};

const toggleRoot = (): void => {
  rootExpanded.value = !rootExpanded.value;
};

const toggleDirectory = async (path: string): Promise<void> => {
  const nextExpanded = !expandedPaths[path];
  expandedPaths[path] = nextExpanded;

  if (!nextExpanded || childrenMap[path] !== undefined) {
    return;
  }

  await loadDirectoryEntries(path);
};

const handleOpenFile = (path: string): void => {
  emit('open-file', path);
};

watch(
  [
    () => props.isDesktopRuntime,
    () => props.workspaceRootPath,
    isExplorerView,
    () => props.preloadedWorkspaceRoot,
  ],
  ([ready, workspaceRootPath, explorer]) => {
    if (!ready || !explorer) {
      return;
    }

    const workspaceKey = workspaceRootPath ?? '__empty_workspace__';
    if (loadedWorkspaceKey.value === workspaceKey && root.value) {
      return;
    }

    void loadWorkspaceRoot(workspaceKey);
  },
  { immediate: true },
);
</script>

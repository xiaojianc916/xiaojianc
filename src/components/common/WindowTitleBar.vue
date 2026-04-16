<template>
  <header class="window-titlebar border-b border-white/[0.06]">
    <div class="flex h-12 items-center gap-3 pl-4 pr-2">
      <div
        class="flex min-w-0 flex-1 items-center gap-3"
        data-tauri-drag-region
        @dblclick="handleToggleMaximize"
      >
        <div
          class="flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-xs font-semibold text-[var(--text-secondary)]"
        >
          SH
        </div>
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-[var(--text-primary)]">SH 编辑器</p>
          <p class="truncate text-[11px] text-[var(--text-quaternary)]">
            Linux Shell / Bash 脚本工作台
          </p>
        </div>
      </div>

      <div
        v-if="isDesktopRuntime"
        class="flex items-center gap-1"
      >
        <button
          class="window-control-button"
          type="button"
          aria-label="最小化"
          title="最小化"
          @click="handleMinimize"
        >
          <svg
            viewBox="0 0 10 10"
            aria-hidden="true"
            class="h-3.5 w-3.5"
          >
            <path
              d="M1 5h8"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-width="1.2"
            />
          </svg>
        </button>

        <button
          class="window-control-button"
          type="button"
          :aria-label="isMaximized ? '向下还原' : '最大化'"
          :title="isMaximized ? '向下还原' : '最大化'"
          @click="handleToggleMaximize"
        >
          <svg
            v-if="!isMaximized"
            viewBox="0 0 10 10"
            aria-hidden="true"
            class="h-3.5 w-3.5"
          >
            <rect
              x="1.5"
              y="1.5"
              width="7"
              height="7"
              fill="none"
              rx="0.5"
              stroke="currentColor"
              stroke-width="1.1"
            />
          </svg>
          <svg
            v-else
            viewBox="0 0 10 10"
            aria-hidden="true"
            class="h-3.5 w-3.5"
          >
            <path
              d="M3 1.5h5.5V7M7 3H1.5v5.5H7z"
              fill="none"
              stroke="currentColor"
              stroke-linejoin="round"
              stroke-width="1.1"
            />
          </svg>
        </button>

        <button
          class="window-control-button window-control-button-danger"
          type="button"
          aria-label="关闭"
          title="关闭"
          @click="handleClose"
        >
          <svg
            viewBox="0 0 10 10"
            aria-hidden="true"
            class="h-3.5 w-3.5"
          >
            <path
              d="M2 2l6 6M8 2L2 8"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-width="1.2"
            />
          </svg>
        </button>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import type { UnlistenFn } from '@tauri-apps/api/event';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { desktopRuntimeReady, waitForDesktopRuntime } from '@/utils/desktop-runtime';

const isMaximized = ref(false);
const isDesktopRuntime = desktopRuntimeReady;

let unlistenResize: UnlistenFn | null = null;

const getAppWindow = async () => {
  const runtimeReady = await waitForDesktopRuntime();
  if (!runtimeReady) {
    return null;
  }

  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
};

const syncWindowState = async (): Promise<void> => {
  const appWindow = await getAppWindow();
  if (!appWindow) {
    return;
  }

  try {
    isMaximized.value = await appWindow.isMaximized();
  } catch (error) {
    console.warn('读取窗口最大化状态失败', error);
  }
};

const handleMinimize = async (): Promise<void> => {
  const appWindow = await getAppWindow();
  if (!appWindow) {
    return;
  }

  await appWindow.minimize();
};

const handleToggleMaximize = async (): Promise<void> => {
  const appWindow = await getAppWindow();
  if (!appWindow) {
    return;
  }

  await appWindow.toggleMaximize();
  await syncWindowState();
};

const handleClose = async (): Promise<void> => {
  const appWindow = await getAppWindow();
  if (!appWindow) {
    return;
  }

  await appWindow.close();
};

onMounted(async () => {
  const appWindow = await getAppWindow();
  if (!appWindow) {
    return;
  }

  await syncWindowState();
  unlistenResize = await appWindow.onResized(() => {
    void syncWindowState();
  });
});

onBeforeUnmount(() => {
  if (unlistenResize) {
    unlistenResize();
    unlistenResize = null;
  }
});
</script>

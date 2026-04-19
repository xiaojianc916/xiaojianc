<template>
  <div class="app-root-stage" :class="{ 'is-splash-mode': isWindowSplashMode }">
    <div
      v-if="isContentMounted && workbenchComponent && !runtimeErrorState"
      class="app-content-entry"
      :class="{ 'is-visible': isAppContentVisible }"
    >
      <component :is="workbenchComponent" @ready="handleWorkbenchReady" />
    </div>

    <SplashScreen
      v-if="isSplashVisible"
      :ready="isApplicationReady"
      :error="runtimeErrorState"
      @leave-start="handleSplashLeaveStart"
      @after-leave="handleSplashAfterLeave"
    />
  </div>
</template>

<script setup lang="ts">
import SplashScreen from '@/components/common/SplashScreen.vue';
import { runtimeErrorState, setRuntimeError } from '@/utils/runtime-diagnostics';
import type { Component } from 'vue';
import {
  computed,
  markRaw,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue';

const MAIN_WINDOW_SIZE = {
  width: 1500,
  height: 960,
};

const MAIN_WINDOW_MIN_SIZE = {
  width: 1220,
  height: 760,
};

const MAIN_CONTENT_REVEAL_DELAY_MS = 50;

const isSplashMounted = ref(true);
const isContentMounted = ref(false);
const isAppContentVisible = ref(false);
const isWorkbenchModuleReady = ref(false);
const isWorkbenchViewReady = ref(false);
const workbenchComponent = shallowRef<Component | null>(null);
const isWindowSplashMode = ref(true);
let revealMainWindowPromise: Promise<void> | null = null;
let revealDelayTimerId: number | null = null;

const applyNativeWindowStage = async (stage: 'splash' | 'main'): Promise<boolean> => {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('apply_window_stage', { stage });
    return true;
  } catch (error) {
    console.warn(`切换窗口阶段失败：${stage}`, error);
    return false;
  }
};

const withCurrentWindow = async (
  action: (
    appWindow: Awaited<ReturnType<typeof import('@tauri-apps/api/window').getCurrentWindow>>,
    logicalSize: typeof import('@tauri-apps/api/dpi').LogicalSize,
  ) => Promise<void>,
): Promise<void> => {
  const [{ getCurrentWindow }, { LogicalSize }] = await Promise.all([
    import('@tauri-apps/api/window'),
    import('@tauri-apps/api/dpi'),
  ]);

  await action(getCurrentWindow(), LogicalSize);
};

const applyMainWindowFrame = async (): Promise<void> => {
  try {
    if (await applyNativeWindowStage('main')) {
      return;
    }

    await withCurrentWindow(async (appWindow, LogicalSize) => {
      await appWindow.setResizable(true);
      await appWindow.setSize(new LogicalSize(MAIN_WINDOW_SIZE.width, MAIN_WINDOW_SIZE.height));
      await appWindow.setMinSize(
        new LogicalSize(MAIN_WINDOW_MIN_SIZE.width, MAIN_WINDOW_MIN_SIZE.height),
      );
      await appWindow.center();
      await appWindow.setFocus();
    });
  } catch (error) {
    console.warn('恢复主窗口尺寸失败', error);
  }
};

const loadWorkbenchModule = async (): Promise<void> => {
  isWorkbenchViewReady.value = false;

  try {
    const module = await import('@/views/ShellWorkbenchView.vue');
    workbenchComponent.value = markRaw(module.default);
    isContentMounted.value = true;
  } catch (error) {
    setRuntimeError('工作台模块加载失败', error);
  } finally {
    isWorkbenchModuleReady.value = true;
  }
};

const isApplicationReady = computed(
  () =>
    !runtimeErrorState.value &&
    isWorkbenchModuleReady.value &&
    isWorkbenchViewReady.value &&
    Boolean(workbenchComponent.value),
);

const isSplashVisible = computed(() => isSplashMounted.value || Boolean(runtimeErrorState.value));

const setDocumentSplashMode = (enabled: boolean): void => {
  document.documentElement.classList.toggle('splash-window-mode', enabled);
  document.body.classList.toggle('splash-window-mode', enabled);
};

const waitForMainRevealDelay = (): Promise<void> =>
  new Promise((resolve) => {
    if (revealDelayTimerId !== null) {
      window.clearTimeout(revealDelayTimerId);
    }

    revealDelayTimerId = window.setTimeout(() => {
      revealDelayTimerId = null;
      resolve();
    }, MAIN_CONTENT_REVEAL_DELAY_MS);
  });

const waitForStablePaint = (): Promise<void> =>
  new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        resolve();
      });
    });
  });

const revealMainWindow = async (): Promise<void> => {
  if (runtimeErrorState.value) {
    return;
  }

  if (revealMainWindowPromise) {
    await revealMainWindowPromise;
    return;
  }

  isWindowSplashMode.value = false;
  setDocumentSplashMode(false);

  revealMainWindowPromise = Promise.all([applyMainWindowFrame(), waitForMainRevealDelay()])
    .then(async () => {
      isContentMounted.value = true;
      await nextTick();
      await waitForStablePaint();
      isAppContentVisible.value = true;
    })
    .finally(() => {
      revealMainWindowPromise = null;
    });

  await revealMainWindowPromise;
};

const handleSplashLeaveStart = (): void => {
  isAppContentVisible.value = false;
};

const handleSplashAfterLeave = async (): Promise<void> => {
  if (runtimeErrorState.value) {
    return;
  }

  isSplashMounted.value = false;
  await revealMainWindow();
};

const handleWorkbenchReady = (): void => {
  isWorkbenchViewReady.value = true;
};

watch(runtimeErrorState, (error) => {
  if (!error) {
    return;
  }

  revealMainWindowPromise = null;
  if (revealDelayTimerId !== null) {
    window.clearTimeout(revealDelayTimerId);
    revealDelayTimerId = null;
  }
  isWindowSplashMode.value = true;
  setDocumentSplashMode(true);
  isSplashMounted.value = true;
  isContentMounted.value = false;
  isAppContentVisible.value = false;
  isWorkbenchViewReady.value = false;
});

watch(isWindowSplashMode, (visible) => setDocumentSplashMode(visible), { immediate: true });

onMounted(() => {
  void loadWorkbenchModule();
});

onBeforeUnmount(() => {
  if (revealDelayTimerId !== null) {
    window.clearTimeout(revealDelayTimerId);
    revealDelayTimerId = null;
  }

  setDocumentSplashMode(false);
});
</script>

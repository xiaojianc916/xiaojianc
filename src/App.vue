<template>
  <component :is="entryComponent" />
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue';
import AppErrorScreen from '@/components/common/AppErrorScreen.vue';
import AppLoadingScreen from '@/components/common/AppLoadingScreen.vue';
import { runtimeErrorState } from '@/utils/runtime-diagnostics';
import { setRuntimeError } from '@/utils/runtime-diagnostics';

const AsyncWorkbench = defineAsyncComponent({
  loader: async () => {
    const module = await import('@/views/ShellWorkbenchView.vue');
    return module.default;
  },
  loadingComponent: AppLoadingScreen,
  errorComponent: AppErrorScreen,
  delay: 0,
  timeout: 15000,
  onError(error, _retry, fail) {
    setRuntimeError('工作台模块加载失败', error);
    fail();
  },
});

const entryComponent = computed(() =>
  runtimeErrorState.value ? AppErrorScreen : AsyncWorkbench,
);
</script>

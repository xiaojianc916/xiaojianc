import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { TThemeMode } from '@/types/app';

const STORAGE_KEY = 'sh-editor-theme';

export const useAppStore = defineStore('app', () => {
  const theme = ref<TThemeMode>((localStorage.getItem(STORAGE_KEY) as TThemeMode) || 'dark');

  const isDark = computed(() => theme.value === 'dark');

  const applyTheme = (value: TThemeMode): void => {
    theme.value = value;
  };

  watch(
    theme,
    (value) => {
      document.documentElement.dataset.theme = value;
      localStorage.setItem(STORAGE_KEY, value);
    },
    { immediate: true },
  );

  return {
    theme,
    isDark,
    applyTheme,
  };
});

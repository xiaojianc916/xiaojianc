import type { TThemeMode } from '@/types/app';
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';

const STORAGE_KEY = 'sh-editor-theme';
const DEFAULT_THEME: TThemeMode = 'dark' as TThemeMode;

// 运行时合法取值集合。如果 TThemeMode 以后加了 'system'，把它加进来即可。
const KNOWN_THEMES: ReadonlyArray<TThemeMode> = ['light', 'dark', 'system'] as TThemeMode[];
const isKnownTheme = (value: unknown): value is TThemeMode =>
  typeof value === 'string' && (KNOWN_THEMES as readonly string[]).includes(value);

const hasWindow = (): boolean => typeof window !== 'undefined';
const hasDocument = (): boolean => typeof document !== 'undefined';

const readStoredTheme = (): TThemeMode | null => {
  if (!hasWindow()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isKnownTheme(raw) ? raw : null;
  } catch {
    return null;
  }
};

const writeStoredTheme = (value: TThemeMode): void => {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // 隐私模式 / 存储配额满 / 被策略禁用时忽略
  }
};

const getSystemPrefersDark = (): boolean => {
  if (!hasWindow() || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
};

/** 把 TThemeMode 归一成实际要应用到 DOM 的 'light' | 'dark'。*/
const resolveEffectiveTheme = (value: TThemeMode): 'light' | 'dark' => {
  if ((value as string) === 'system') {
    return getSystemPrefersDark() ? 'dark' : 'light';
  }
  return value === 'light' ? 'light' : 'dark';
};

const applyThemeToDocument = (effective: 'light' | 'dark'): void => {
  if (!hasDocument()) return;
  const root = document.documentElement;
  if (!root) return;
  root.dataset.theme = effective;
  // classList 兼容一些只认 class 的 UI 库（Tailwind dark mode 等）
  root.classList.toggle('dark', effective === 'dark');
  root.classList.toggle('light', effective === 'light');
};

export const useAppStore = defineStore('app', () => {
  const theme = ref<TThemeMode>(readStoredTheme() ?? DEFAULT_THEME);
  const effectiveTheme = ref<'light' | 'dark'>(resolveEffectiveTheme(theme.value));

  const isDark = computed(() => effectiveTheme.value === 'dark');

  const applyTheme = (value: TThemeMode): void => {
    if (!isKnownTheme(value)) return;
    if (theme.value === value) return;
    theme.value = value;
  };

  const toggleTheme = (): void => {
    applyTheme(isDark.value ? ('light' as TThemeMode) : ('dark' as TThemeMode));
  };

  // theme 变动：写盘 + 重新计算 effective
  watch(theme, (value, oldValue) => {
    if (value === oldValue) return;
    writeStoredTheme(value);
    effectiveTheme.value = resolveEffectiveTheme(value);
  });

  // effectiveTheme 变动：落到 DOM
  watch(
    effectiveTheme,
    (value) => {
      applyThemeToDocument(value);
    },
    { immediate: true },
  );

  // 跨标签页 / 多窗口同步
  if (hasWindow()) {
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY) return;
      const next = isKnownTheme(event.newValue) ? event.newValue : null;
      if (next && next !== theme.value) {
        theme.value = next;
      }
    });
  }

  // 当用户选择 'system' 时，跟随系统 prefers-color-scheme 变化
  if (hasWindow() && typeof window.matchMedia === 'function') {
    try {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleSystemThemeChange = (): void => {
        if ((theme.value as string) !== 'system') return;
        effectiveTheme.value = resolveEffectiveTheme(theme.value);
      };
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleSystemThemeChange);
      } else if (typeof (mediaQuery as unknown as { addListener?: (cb: () => void) => void })
        .addListener === 'function') {
        // 兼容老浏览器
        (mediaQuery as unknown as { addListener: (cb: () => void) => void }).addListener(
          handleSystemThemeChange,
        );
      }
    } catch {
      // 忽略 matchMedia 异常
    }
  }

  return {
    theme,
    effectiveTheme,
    isDark,
    applyTheme,
    toggleTheme,
  };
});
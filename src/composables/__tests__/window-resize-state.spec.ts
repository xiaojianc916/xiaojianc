import { useWindowResizeState } from '@/composables/useWindowResizeState';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, type EffectScope } from 'vue';

const { getCurrentWindowMock, listenerOffMock, state } = vi.hoisted(() => ({
  getCurrentWindowMock: vi.fn(),
  listenerOffMock: vi.fn(),
  state: {
    resizeHandler: undefined as (() => void) | undefined,
  },
}));

const installTauriWindowRuntime = (): void => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: {
      invoke: vi.fn(),
      metadata: {
        currentWindow: {
          label: 'main',
        },
      },
    },
  });
};

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: getCurrentWindowMock,
}));

describe('useWindowResizeState', () => {
  let scope: EffectScope;

  beforeEach(() => {
    vi.useFakeTimers();
    document.documentElement.classList.remove('is-resizing');
    listenerOffMock.mockReset();
    getCurrentWindowMock.mockReset();
    state.resizeHandler = undefined;
    installTauriWindowRuntime();
    getCurrentWindowMock.mockReturnValue({
      onResized: vi.fn((handler: () => void) => {
        state.resizeHandler = handler;
        return Promise.resolve(listenerOffMock);
      }),
    });
    scope = effectScope();
  });

  afterEach(() => {
    scope.stop();
    document.documentElement.classList.remove('is-resizing');
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('窗口 resize 时立即添加 is-resizing', async () => {
    scope.run(() => useWindowResizeState());
    await Promise.resolve();

    state.resizeHandler?.();

    expect(document.documentElement.classList.contains('is-resizing')).toBe(true);
  });

  it('120ms 后自动移除 is-resizing', async () => {
    scope.run(() => useWindowResizeState());
    await Promise.resolve();

    state.resizeHandler?.();
    await vi.advanceTimersByTimeAsync(120);

    expect(document.documentElement.classList.contains('is-resizing')).toBe(false);
  });

  it('scope dispose 清理 timer 与 resize listener', async () => {
    scope.run(() => useWindowResizeState());
    await Promise.resolve();

    state.resizeHandler?.();
    scope.stop();
    await vi.advanceTimersByTimeAsync(120);

    expect(listenerOffMock).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList.contains('is-resizing')).toBe(false);
  });

  it('浏览器预览模式下跳过 Tauri resize 监听', () => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');

    scope.run(() => useWindowResizeState());

    expect(getCurrentWindowMock).not.toHaveBeenCalled();
  });

  it('收到 resize-start 事件时立即进入 is-resizing', () => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');

    scope.run(() => useWindowResizeState());
    window.dispatchEvent(new Event('shell-window-resize-start'));

    expect(document.documentElement.classList.contains('is-resizing')).toBe(true);
  });
});

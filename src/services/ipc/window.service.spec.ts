import { AppError } from '@/types/app-error';
import { invoke } from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyWindowStage,
  setWindowBackground,
} from './window.service';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke?: typeof invoke;
    };
  }
}

describe('services/ipc/window.service', () => {
  const invokeMock = vi.mocked(invoke);

  beforeEach(() => {
    invokeMock.mockReset();
    window.__TAURI_INTERNALS__ = {
      invoke: invokeMock,
    };
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete window.__TAURI_INTERNALS__;
  });

  it('成功路径通过 tauri-specta binding 传递 input 与 traceId', async () => {
    invokeMock.mockResolvedValue(null);

    await expect(setWindowBackground({ r: 10, g: 20, b: 30 })).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledWith('set_window_background', {
      input: {
        label: null,
        r: 10,
        g: 20,
        b: 30,
        a: 255,
      },
      traceId: expect.any(String),
    });
  });

  it('超时时归一化为 AppError(scope="ipc")', async () => {
    vi.useFakeTimers();
    invokeMock.mockImplementation(() => new Promise(() => undefined));

    const assertion = expect(
      setWindowBackground({ r: 10, g: 20, b: 30, a: 255 }),
    ).rejects.toMatchObject({
      code: 'ipc.timeout',
      scope: 'ipc',
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await assertion;
  });

  it('Rust 错误归一化为 AppError(scope="ipc")', async () => {
    invokeMock.mockRejectedValue(new Error('window `main` not found'));

    let caughtError: unknown;
    try {
      await setWindowBackground({ r: 10, g: 20, b: 30, a: 255 });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(AppError);
    expect(caughtError).toMatchObject({
      scope: 'ipc',
    });
  });

  it('窗口阶段通过统一 IPC 层传递 stage', async () => {
    invokeMock.mockResolvedValue(null);

    await expect(applyWindowStage({ stage: 'main' })).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledWith('apply_window_stage', {
      stage: 'main',
    });
  });
});

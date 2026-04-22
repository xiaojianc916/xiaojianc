import { logger } from '@/utils/logger';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { onScopeDispose } from 'vue';

const RESET_DELAY_MS = 120;
const TAURI_INTERNALS_KEY = '__TAURI_INTERNALS__';

interface IResizeEventSource {
  onResized(handler: () => void): Promise<() => void>;
}

const readObjectProperty = (source: unknown, key: string): unknown => {
  if (typeof source !== 'object' || source === null) {
    return undefined;
  }

  return Reflect.get(source, key);
};

const hasTauriWindowRuntime = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  const internals = readObjectProperty(window, TAURI_INTERNALS_KEY);
  const invoke = readObjectProperty(internals, 'invoke');
  const metadata = readObjectProperty(internals, 'metadata');
  const currentWindow = readObjectProperty(metadata, 'currentWindow');
  const label = readObjectProperty(currentWindow, 'label');

  return typeof invoke === 'function' && typeof label === 'string' && label.length > 0;
};

const isResizeEventSource = (value: unknown): value is IResizeEventSource =>
  typeof value === 'object' &&
  value !== null &&
  'onResized' in value &&
  typeof value.onResized === 'function';

export const useWindowResizeState = () => {
  const html = document.documentElement;
  let timer: number | undefined;
  let unlisten: (() => void) | undefined;
  let isDisposed = false;

  const clearResizeTimer = (): void => {
    if (timer === undefined) {
      return;
    }

    window.clearTimeout(timer);
    timer = undefined;
  };

  const markResizing = (): void => {
    html.classList.add('is-resizing');
    clearResizeTimer();
    timer = window.setTimeout(() => {
      html.classList.remove('is-resizing');
      timer = undefined;
    }, RESET_DELAY_MS);
  };

  onScopeDispose(() => {
    isDisposed = true;
    clearResizeTimer();
    unlisten?.();
    html.classList.remove('is-resizing');
  });

  if (!hasTauriWindowRuntime()) {
    return {
      markResizing,
    };
  }

  let currentWindow: unknown;
  try {
    currentWindow = getCurrentWindow();
  } catch (err) {
    logger.warn({
      event: 'window.resize_listener.failed',
      err,
    });
    return {
      markResizing,
    };
  }

  if (isResizeEventSource(currentWindow)) {
    void currentWindow
      .onResized(markResizing)
      .then((off) => {
        if (isDisposed) {
          off();
          return;
        }

        unlisten = off;
      })
      .catch((err: unknown) => {
        logger.warn({
          event: 'window.resize_listener.failed',
          err,
        });
      });
  }

  return {
    markResizing,
  };
};

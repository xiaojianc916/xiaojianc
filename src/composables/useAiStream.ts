import { computed, getCurrentScope, onScopeDispose, ref } from 'vue';

type TAiStreamStatus = 'idle' | 'streaming' | 'completed' | 'cancelled';

type TFrameHandle =
  | { kind: 'raf'; id: number }
  | { kind: 'timeout'; id: ReturnType<typeof setTimeout> };

export interface IUseAiStreamOptions {
  messageId?: string;
}

export interface IAiStreamStartOptions {
  messageId?: string;
}

const DEFAULT_FRAME_MS = 16.7;

export const useAiStream = (options: IUseAiStreamOptions = {}) => {
  void options;

  const content = ref('');
  const status = ref<TAiStreamStatus>('idle');
  const bufferedGraphemeCount = ref(0);
  const maxBufferedGraphemeCount = ref(0);

  let pendingText = '';
  let frameHandle: TFrameHandle | null = null;
  let isFrameScheduled = false;

  const countBufferedText = (text: string): number => Array.from(text).length;

  const updateBufferMetrics = (): void => {
    bufferedGraphemeCount.value = countBufferedText(pendingText);
    maxBufferedGraphemeCount.value = Math.max(
      maxBufferedGraphemeCount.value,
      bufferedGraphemeCount.value,
    );
  };

  const cancelFrame = (): void => {
    if (frameHandle?.kind === 'raf') {
      globalThis.cancelAnimationFrame?.(frameHandle.id);
    }

    if (frameHandle?.kind === 'timeout') {
      clearTimeout(frameHandle.id);
    }

    frameHandle = null;
    isFrameScheduled = false;
  };

  const flushPendingText = (): void => {
    if (!pendingText) {
      return;
    }

    content.value += pendingText;
    pendingText = '';
    updateBufferMetrics();
  };

  const resetPacingState = (): void => {
    cancelFrame();
    pendingText = '';
    bufferedGraphemeCount.value = 0;
  };

  const releaseFrame = (): void => {
    frameHandle = null;
    isFrameScheduled = false;

    if (status.value !== 'streaming') {
      return;
    }

    flushPendingText();

  };

  function scheduleFrame(): void {
    if (isFrameScheduled) {
      return;
    }

    isFrameScheduled = true;
    let didRunSynchronously = false;

    if (typeof globalThis.requestAnimationFrame === 'function') {
      const frameId = globalThis.requestAnimationFrame(() => {
        didRunSynchronously = true;
        releaseFrame();
      });

      if (!didRunSynchronously) {
        frameHandle = {
          kind: 'raf',
          id: frameId,
        };
      }

      return;
    }

    frameHandle = {
      kind: 'timeout',
      id: setTimeout(() => {
        releaseFrame();
      }, DEFAULT_FRAME_MS),
    };
  }

  const start = (startOptions: Readonly<IAiStreamStartOptions> = {}): void => {
    void startOptions;
    resetPacingState();
    content.value = '';
    maxBufferedGraphemeCount.value = 0;
    status.value = 'streaming';
  };

  const append = (chunk: string): void => {
    if (status.value !== 'streaming' || !chunk) {
      return;
    }

    pendingText += chunk;
    updateBufferMetrics();
    scheduleFrame();
  };

  const flushNow = (): void => {
    cancelFrame();
    flushPendingText();
  };

  const complete = (): void => {
    if (status.value !== 'streaming') {
      return;
    }

    flushNow();
    status.value = 'completed';
  };

  const stop = (): void => {
    flushNow();
    status.value = 'cancelled';
  };

  if (getCurrentScope()) {
    onScopeDispose(() => {
      resetPacingState();
    });
  }

  return {
    content,
    bufferedGraphemeCount: computed(() => bufferedGraphemeCount.value),
    isStreaming: computed(() => status.value === 'streaming'),
    maxBufferedGraphemeCount: computed(() => maxBufferedGraphemeCount.value),
    status: computed(() => status.value),
    start,
    append,
    flushNow,
    complete,
    stop,
  };
};

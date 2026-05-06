import { splitTextGraphemes } from '@/utils/text-preview';
import { computed, getCurrentScope, onScopeDispose, ref } from 'vue';

type TAiStreamStatus = 'idle' | 'streaming' | 'completed' | 'cancelled';

type TFrameHandle =
  | { kind: 'raf'; id: number }
  | { kind: 'timeout'; id: ReturnType<typeof setTimeout> };

export interface IUseAiStreamOptions {
  messageId?: string;
  minGraphemesPerSecond?: number;
  maxGraphemesPerSecond?: number;
  targetBufferedMs?: number;
  maxGraphemesPerFrame?: number;
}

export interface IAiStreamStartOptions {
  messageId?: string;
}

const DEFAULT_SEGMENT_LOCALE = ['zh-CN', 'en'];
const DEFAULT_MIN_GRAPHEMES_PER_SECOND = 48;
const DEFAULT_MAX_GRAPHEMES_PER_SECOND = 240;
const DEFAULT_TARGET_BUFFERED_MS = 280;
const DEFAULT_MAX_GRAPHEMES_PER_FRAME = 10;
const DEFAULT_FRAME_MS = 16.7;
const MIN_FRAME_MS = 8;
const MAX_FRAME_MS = 64;

const toPositiveNumber = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const useAiStream = (options: IUseAiStreamOptions = {}) => {
  const content = ref('');
  const status = ref<TAiStreamStatus>('idle');
  const bufferedGraphemeCount = ref(0);
  const maxBufferedGraphemeCount = ref(0);
  const minRate = toPositiveNumber(
    options.minGraphemesPerSecond,
    DEFAULT_MIN_GRAPHEMES_PER_SECOND,
  );
  const maxRate = Math.max(
    minRate,
    toPositiveNumber(options.maxGraphemesPerSecond, DEFAULT_MAX_GRAPHEMES_PER_SECOND),
  );
  const targetBufferedMs = toPositiveNumber(options.targetBufferedMs, DEFAULT_TARGET_BUFFERED_MS);
  const maxGraphemesPerFrame = Math.max(
    1,
    Math.floor(toPositiveNumber(options.maxGraphemesPerFrame, DEFAULT_MAX_GRAPHEMES_PER_FRAME)),
  );

  let queuedGraphemes: string[] = [];
  let heldTailGrapheme = '';
  let frameHandle: TFrameHandle | null = null;
  let isFrameScheduled = false;
  let lastFrameAt: number | null = null;
  let releaseCredit = 0;

  const updateBufferMetrics = (): void => {
    bufferedGraphemeCount.value = queuedGraphemes.length + (heldTailGrapheme ? 1 : 0);
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

  const resetPacingState = (): void => {
    cancelFrame();
    queuedGraphemes = [];
    heldTailGrapheme = '';
    bufferedGraphemeCount.value = 0;
    lastFrameAt = null;
    releaseCredit = 0;
  };

  const getFrameElapsedMs = (timestamp: number): number => {
    const safeTimestamp = Number.isFinite(timestamp) && timestamp > 0
      ? timestamp
      : (lastFrameAt ?? DEFAULT_FRAME_MS);

    if (lastFrameAt === null) {
      lastFrameAt = safeTimestamp;
      return DEFAULT_FRAME_MS;
    }

    const elapsedMs = safeTimestamp - lastFrameAt;
    lastFrameAt = safeTimestamp;

    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
      return DEFAULT_FRAME_MS;
    }

    return clamp(elapsedMs, MIN_FRAME_MS, MAX_FRAME_MS);
  };

  const resolveReleaseCount = (elapsedMs: number): number => {
    if (queuedGraphemes.length === 0) {
      return 0;
    }

    const pendingGraphemeCount = queuedGraphemes.length + (heldTailGrapheme ? 1 : 0);
    const adaptiveRate = clamp(
      (pendingGraphemeCount * 1000) / targetBufferedMs,
      minRate,
      maxRate,
    );
    releaseCredit += (adaptiveRate * elapsedMs) / 1000;

    const creditedCount = Math.floor(releaseCredit);
    const nextCount = clamp(
      creditedCount > 0 ? creditedCount : 1,
      1,
      Math.min(maxGraphemesPerFrame, queuedGraphemes.length),
    );

    releaseCredit = Math.max(0, releaseCredit - nextCount);

    return nextCount;
  };

  const releaseFrame = (timestamp: number): void => {
    frameHandle = null;
    isFrameScheduled = false;

    if (status.value !== 'streaming') {
      return;
    }

    if (queuedGraphemes.length === 0) {
      if (heldTailGrapheme) {
        content.value += heldTailGrapheme;
        heldTailGrapheme = '';
        updateBufferMetrics();
      }

      lastFrameAt = null;
      releaseCredit = 0;
      return;
    }

    const releaseCount = resolveReleaseCount(getFrameElapsedMs(timestamp));

    if (releaseCount > 0) {
      content.value += queuedGraphemes.splice(0, releaseCount).join('');
      updateBufferMetrics();
    }

    if (queuedGraphemes.length > 0 || heldTailGrapheme) {
      scheduleFrame();
    }
  };

  function scheduleFrame(): void {
    if (isFrameScheduled) {
      return;
    }

    isFrameScheduled = true;
    let didRunSynchronously = false;

    if (typeof globalThis.requestAnimationFrame === 'function') {
      const frameId = globalThis.requestAnimationFrame((timestamp) => {
        didRunSynchronously = true;
        releaseFrame(timestamp);
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
        releaseFrame(DEFAULT_FRAME_MS);
      }, DEFAULT_FRAME_MS),
    };
  }

  const enqueueDelta = (chunk: string): void => {
    const graphemes = splitTextGraphemes(
      `${heldTailGrapheme}${chunk}`,
      DEFAULT_SEGMENT_LOCALE,
    );

    if (graphemes.length === 0) {
      heldTailGrapheme = '';
      updateBufferMetrics();
      return;
    }

    if (graphemes.length === 1) {
      heldTailGrapheme = graphemes[0] ?? '';
      updateBufferMetrics();
      return;
    }

    const nextTail = graphemes.at(-1) ?? '';
    queuedGraphemes.push(...graphemes.slice(0, -1));
    heldTailGrapheme = nextTail;
    updateBufferMetrics();
  };

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

    enqueueDelta(chunk);

    if (queuedGraphemes.length > 0 || heldTailGrapheme) {
      scheduleFrame();
    }
  };

  const flushNow = (): void => {
    cancelFrame();

    if (heldTailGrapheme) {
      queuedGraphemes.push(heldTailGrapheme);
      heldTailGrapheme = '';
    }

    if (queuedGraphemes.length > 0) {
      content.value += queuedGraphemes.join('');
      queuedGraphemes = [];
    }

    updateBufferMetrics();
    lastFrameAt = null;
    releaseCredit = 0;
  };

  const complete = (): void => {
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

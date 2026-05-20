import { useAiStream } from '@/composables/ai/useAiStream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, type EffectScope } from 'vue';

interface IStreamHarness {
  stream: ReturnType<typeof useAiStream>;
  scope: EffectScope;
}

const createStreamHarness = (
  options: Parameters<typeof useAiStream>[0] = {},
): IStreamHarness => {
  const scope = effectScope();
  let stream: ReturnType<typeof useAiStream> | null = null;

  scope.run(() => {
    stream = useAiStream(options);
  });

  if (!stream) {
    throw new Error('useAiStream 初始化失败');
  }

  return {
    stream,
    scope,
  };
};

describe('useAiStream', () => {
  let frameId = 0;
  let queuedFrames: Map<number, FrameRequestCallback>;

  const runNextFrame = (timestamp: number): void => {
    const frame = [...queuedFrames.entries()][0];

    if (!frame) {
      throw new Error('没有待执行的动画帧');
    }

    const [id, callback] = frame;
    queuedFrames.delete(id);
    callback(timestamp);
  };

  beforeEach(() => {
    frameId = 0;
    queuedFrames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      frameId += 1;
      queuedFrames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
      queuedFrames.delete(id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('按帧合并 burst delta，不拆分真实到达的内容', () => {
    const { stream, scope } = createStreamHarness();

    stream.start();
    stream.append('abcdef');

    expect(stream.content.value).toBe('');
    expect(stream.bufferedGraphemeCount.value).toBe(6);
    expect(stream.maxBufferedGraphemeCount.value).toBe(6);
    expect(queuedFrames.size).toBe(1);

    runNextFrame(16);
    expect(stream.content.value).toBe('abcdef');
    expect(stream.bufferedGraphemeCount.value).toBe(0);
    expect(stream.maxBufferedGraphemeCount.value).toBe(6);

    stream.complete();
    expect(stream.content.value).toBe('abcdef');
    expect(stream.bufferedGraphemeCount.value).toBe(0);
    expect(stream.status.value).toBe('completed');

    scope.stop();
  });

  it('完成时立即冲刷缓冲，保证最终内容完整', () => {
    const { stream, scope } = createStreamHarness();

    stream.start();
    stream.append('你好🙂');
    stream.complete();

    expect(stream.content.value).toBe('你好🙂');
    expect(stream.bufferedGraphemeCount.value).toBe(0);
    expect(stream.maxBufferedGraphemeCount.value).toBe(3);
    expect(stream.status.value).toBe('completed');
    expect(queuedFrames.size).toBe(0);

    scope.stop();
  });

  it('完成时不会慢放剩余内容，避免伪流式拖慢真实输出', () => {
    const { stream, scope } = createStreamHarness();

    stream.start();
    stream.append('abcdef');
    stream.complete();

    expect(stream.content.value).toBe('abcdef');
    expect(stream.status.value).toBe('completed');
    expect(queuedFrames.size).toBe(0);

    scope.stop();
  });

  it('取消时保留已经到达的内容，并忽略后续迟到 delta', () => {
    const { stream, scope } = createStreamHarness();

    stream.start();
    stream.append('已经到达');
    stream.stop();
    stream.append('不应进入');

    expect(stream.content.value).toBe('已经到达');
    expect(stream.bufferedGraphemeCount.value).toBe(0);
    expect(stream.status.value).toBe('cancelled');

    scope.stop();
  });

  it('同一帧内合并跨 delta 的 emoji ZWJ 字符簇', () => {
    const { stream, scope } = createStreamHarness();
    const family = '👨‍👩‍👧‍👦';

    stream.start();
    stream.append('👨');
    stream.append('‍👩‍👧‍👦完成');

    runNextFrame(16);

    expect(stream.content.value).toBe(`${family}完成`);
    expect(stream.content.value).not.toContain('�');

    stream.complete();
    expect(stream.content.value).toBe(`${family}完成`);

    scope.stop();
  });
});

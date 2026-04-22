import { ipc } from '@/services/ipc';
import { zTauriVoid } from '@/services/tauri.contracts';
import { z } from 'zod';

export const SetWindowBackgroundInput = z.object({
  label: z.string().min(1).optional(),
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
  a: z.number().int().min(0).max(255).default(255),
});

export type TSetWindowBackgroundInput = z.infer<typeof SetWindowBackgroundInput>;
export type TSetWindowBackgroundRequest = z.input<typeof SetWindowBackgroundInput>;

const WindowStageInput = z.object({
  stage: z.enum(['splash', 'main']),
});

const SetWindowBackgroundOutput = zTauriVoid;
const WindowStageOutput = zTauriVoid;

/**
 * 同步主窗口原生底色与 Webview 根底色，消除 resize / 主题切换期间的底色撕裂。
 *
 * @throws AppError(scope="ipc")
 */
export const setWindowBackground = (input: TSetWindowBackgroundRequest): Promise<void> =>
  ipc('set_window_background', input, SetWindowBackgroundInput, SetWindowBackgroundOutput, {
    timeoutMs: 1_000,
    guardHint: '同步窗口底色',
    idempotent: true,
    mapArgs: (payload, { traceId }) => ({ input: payload, traceId }),
  });

/**
 * 切换启动 / 工作台窗口阶段；可见性、尺寸和原生窗口副作用保持 Rust 单点驱动。
 */
export const applyWindowStage = (stage: 'splash' | 'main'): Promise<void> =>
  ipc('apply_window_stage', { stage }, WindowStageInput, WindowStageOutput, {
    timeoutMs: 1_500,
    guardHint: '切换窗口阶段',
    mapArgs: (payload) => ({ stage: payload.stage }),
  });

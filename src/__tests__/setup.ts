/**
 * Vitest 全局测试 setup —— 拦截所有 Tauri IPC,确保测试不会触达真实 runtime。
 *
 * ## 设计原则
 *
 * 1. **`invoke` 默认 reject**:让"未显式 mock 的 IPC 调用"快速 fail,
 *    避免测试在沉默中依赖未声明的后端行为。需要测某个 command 的测试,
 *    必须自己 `vi.mocked(invoke).mockResolvedValueOnce(...)`。
 *
 * 2. **`listen` / `once` 返回新的 spy 作为 unlisten**:每次注册都拿到独立
 *    `vi.fn()`,使得 `expect(unlisten).toHaveBeenCalled()` 这类断言可用,
 *    也避免多次 listen 共享同一 unlisten 实例造成的串扰。
 *
 * 3. **`emit` / dialog `open` / `save` 给安静的默认值**:这些通常是 fire-and-forget
 *    或用户操作型 API,测试想覆盖时用 `.mockResolvedValueOnce(...)` 即可。
 *
 * 4. **每个测试开头 clear mock 历史**:防止跨测试调用计数累积。
 *    如果你已经在 `vitest.config.ts` 配了 `test.clearMocks: true`,
 *    下方的 beforeEach 是冗余但无害。
 */

import { beforeEach, vi } from 'vitest';

// ── @tauri-apps/api/core ────────────────────────────────────────────────────

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn().mockRejectedValue(
        new Error(
            '[test-setup] Tauri invoke() was called without an explicit mock. ' +
            'Use vi.mocked(invoke).mockResolvedValueOnce(...) in the test.',
        ),
    ),
}));

// ── @tauri-apps/api/event ───────────────────────────────────────────────────

// 用 mockImplementation 而非 mockResolvedValue —— 每次调用返回**新的** spy
// 作为 unlisten,而不是共享单一实例。这让 "expect(unlisten).toHaveBeenCalled()"
// 对每个具体的 listen() 调用都成立。
vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn().mockImplementation(async () => vi.fn()),
    once: vi.fn().mockImplementation(async () => vi.fn()),
    emit: vi.fn().mockResolvedValue(undefined),
}));

// ── @tauri-apps/plugin-dialog ───────────────────────────────────────────────

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(null),
}));

// ── 测试间隔离 ────────────────────────────────────────────────────────────

// 清掉 mock.calls / mock.instances / mock.results 历史,但**不**重置
// mockResolvedValue / mockImplementation 等行为配置。
//
// 如果你想连默认实现也每个测试重置,改用 vi.resetAllMocks();
// 但那样 invoke 就会变成默认 resolve(undefined),失去 R1 的保护。
beforeEach(() => {
    vi.clearAllMocks();
});

// 确保本文件被视为 module(防 isolatedModules 警告)。
export { };

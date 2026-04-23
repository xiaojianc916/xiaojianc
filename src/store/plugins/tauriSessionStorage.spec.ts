import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadSession = vi.fn();
const mockSaveSession = vi.fn();
const mockClearSession = vi.fn();

vi.mock('@/services/sessionStore', () => ({
  clearSession: mockClearSession,
  loadSession: mockLoadSession,
  saveSession: mockSaveSession,
}));

describe('tauriSessionStorage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createSnapshot = () => ({
    schemaVersion: 1 as const,
    workspaceRoot: '/tmp/workspace',
    openTabs: [],
    activeTabPath: null,
    viewStates: [],
    recentWorkspaces: [],
    recentFiles: [],
    savedAt: new Date().toISOString(),
  });

  it('hydrateSessionStorage 超时后不抛异常，getItem 返回 null', async () => {
    vi.useFakeTimers();
    mockLoadSession.mockReturnValue(new Promise(() => undefined));

    const { hydrateSessionStorage, tauriSessionStorage } = await import(
      '@/store/plugins/tauriSessionStorage'
    );

    const task = hydrateSessionStorage();
    await vi.advanceTimersByTimeAsync(301);
    await task;

    expect(tauriSessionStorage.getItem('shell-ide:editor')).toBeNull();
  });

  it('hydrate 后 getItem 返回缓存快照', async () => {
    mockLoadSession.mockResolvedValue({
      schemaVersion: 1,
      workspaceRoot: '/tmp/workspace',
      openTabs: [],
      activeTabPath: null,
      viewStates: [],
      recentWorkspaces: [],
      recentFiles: [],
      savedAt: new Date().toISOString(),
    });

    const { hydrateSessionStorage, tauriSessionStorage } = await import(
      '@/store/plugins/tauriSessionStorage'
    );

    await hydrateSessionStorage();
    const raw = tauriSessionStorage.getItem('shell-ide:editor');

    expect(raw).not.toBeNull();
    expect(typeof raw).toBe('string');
  });

  it('removeItem 会取消防抖保存并清空持久化快照，避免旧会话回写', async () => {
    vi.useFakeTimers();
    mockLoadSession.mockResolvedValue(null);
    mockSaveSession.mockResolvedValue(undefined);
    mockClearSession.mockResolvedValue(undefined);

    const { hydrateSessionStorage, tauriSessionStorage } = await import(
      '@/store/plugins/tauriSessionStorage'
    );

    await hydrateSessionStorage();
    tauriSessionStorage.setItem(
      'shell-ide:editor',
      JSON.stringify({ sessionSnapshot: createSnapshot() }),
    );
    tauriSessionStorage.removeItem('shell-ide:editor');

    await vi.advanceTimersByTimeAsync(501);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockSaveSession).not.toHaveBeenCalled();
    expect(mockClearSession).toHaveBeenCalledOnce();
    expect(tauriSessionStorage.getItem('shell-ide:editor')).toBeNull();
  });
});

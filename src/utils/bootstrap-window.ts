import {
    MAIN_WINDOW_LABEL,
    WELCOME_WINDOW_LABEL,
    type TAppWindowLabel,
} from './app-window';

interface ITauriInternals {
    invoke?: (cmd: string, args?: Record<string, unknown>, options?: unknown) => Promise<unknown>;
}

/**
 * 判断当前窗口是否为欢迎窗口。
 */
export const isWelcomeWindow = (windowLabel: TAppWindowLabel): boolean =>
    windowLabel === WELCOME_WINDOW_LABEL;

/**
 * 从 URL hash 推导当前窗口标签。
 */
export const resolveWindowLabelFromLocation = (): TAppWindowLabel => {
    if (typeof window === 'undefined') {
        return MAIN_WINDOW_LABEL;
    }

    return window.location.hash.includes('/welcome') ? WELCOME_WINDOW_LABEL : MAIN_WINDOW_LABEL;
};

/**
 * 在启动失败时尽力触发原生窗口过渡，避免主窗口保持隐藏。
 */
export const forceRevealMainWindowOnBootstrapFailure = async (
    currentWindowLabel: TAppWindowLabel,
): Promise<void> => {
    if (isWelcomeWindow(currentWindowLabel) || typeof window === 'undefined') {
        return;
    }

    const invokeFn = (window as Window & { __TAURI_INTERNALS__?: ITauriInternals })
        .__TAURI_INTERNALS__?.invoke;

    if (typeof invokeFn !== 'function') {
        return;
    }

    try {
        await invokeFn('begin_startup_transition');
    } catch {
        // 启动兜底路径下忽略原生过渡失败，优先保证错误面板可见。
    }

    try {
        await invokeFn('finalize_startup_transition');
    } catch {
        // 启动兜底路径下忽略原生过渡失败，优先保证错误面板可见。
    }
};

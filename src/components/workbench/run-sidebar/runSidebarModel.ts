import type { IRunHistoryEntry } from '@/types/editor';

export type TConfigAction = 'run' | 'open-terminal';
export type TQuickAction = 'run' | 'stop' | 'open-terminal' | 'clear-history';
export type TIconName = 'terminal' | 'monitor' | 'spark' | 'history' | 'trash' | 'plus';

export interface IConfigRow {
    id: string;
    name: string;
    command: string;
    icon: TIconName;
    action: TConfigAction;
    disabled: boolean;
    running: boolean;
}

export interface IQuickRow {
    id: string;
    name: string;
    command: string;
    icon: TIconName;
    action: TQuickAction;
    badge: string;
    disabled: boolean;
    running: boolean;
}

interface IBuildQuickRowsOptions {
    isRunning: boolean;
    activeElapsedLabel: string;
    hasActiveDocument: boolean;
    documentName: string;
    canRun: boolean;
    isDesktopRuntime: boolean;
    runHistory: IRunHistoryEntry[];
    hasRunArtifacts: boolean;
}

const resolveQuickRunCommand = (hasActiveDocument: boolean, documentName: string): string =>
    hasActiveDocument ? `执行 ${documentName}` : '当前没有可执行脚本';

const resolveQuickHistoryCommand = (entry: IRunHistoryEntry | null): string =>
    entry ? `${formatHistoryTime(entry.finishedAt)} · ${entry.documentName}` : '查看最近的运行记录';

export const buildQuickRows = (options: IBuildQuickRowsOptions): IQuickRow[] => {
    const {
        isRunning,
        activeElapsedLabel,
        hasActiveDocument,
        documentName,
        canRun,
        isDesktopRuntime,
        runHistory,
        hasRunArtifacts,
    } = options;
    const lastHistoryEntry = runHistory[0] ?? null;

    return [
        {
            id: 'quick-run',
            name: isRunning ? '停止' : '运行',
            command: isRunning ? '向终端发送中断信号' : resolveQuickRunCommand(hasActiveDocument, documentName),
            icon: isRunning ? 'spark' : 'terminal',
            action: isRunning ? 'stop' : 'run',
            badge: isRunning ? activeElapsedLabel || '进行中' : '执行',
            disabled: isRunning ? false : !canRun,
            running: isRunning,
        },
        {
            id: 'quick-terminal',
            name: '终端',
            command: '打开集成终端面板',
            icon: 'monitor',
            action: 'open-terminal',
            badge: '面板',
            disabled: !isDesktopRuntime,
            running: false,
        },
        {
            id: 'quick-history',
            name: '最近',
            command: resolveQuickHistoryCommand(lastHistoryEntry),
            icon: 'history',
            action: 'open-terminal',
            badge: runHistory.length > 0 ? String(runHistory.length) : '0',
            disabled: false,
            running: false,
        },
        {
            id: 'quick-clear',
            name: '清空',
            command: '清理输出与运行历史',
            icon: 'trash',
            action: 'clear-history',
            badge: '重置',
            disabled: !hasRunArtifacts,
            running: false,
        },
    ];
};

export const filterItems = <T extends Record<string, unknown>>(
    items: T[],
    query: string,
    fields: string[],
): T[] => {
    if (!query) {
        return items;
    }

    return items.filter((item) =>
        fields.some((field) => String(item[field] ?? '').toLowerCase().includes(query)),
    );
};

export const formatDuration = (durationMs: number): string => {
    if (durationMs < 1000) {
        return `${durationMs}ms`;
    }

    const totalSeconds = Math.floor(durationMs / 1000);
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) {
        return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
};

export const formatHistoryTime = (isoString: string): string => {
    const target = new Date(isoString);
    if (Number.isNaN(target.getTime())) {
        return '未知时间';
    }

    const now = new Date();
    const hours = String(target.getHours()).padStart(2, '0');
    const minutes = String(target.getMinutes()).padStart(2, '0');

    if (target.toDateString() === now.toDateString()) {
        return `今天 ${hours}:${minutes}`;
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (target.toDateString() === yesterday.toDateString()) {
        return `昨天 ${hours}:${minutes}`;
    }

    return `${target.getMonth() + 1}/${target.getDate()} ${hours}:${minutes}`;
};

export const resolveHistoryExitLabel = (entry: IRunHistoryEntry): string => {
    if (entry.status === 'success' || entry.exitCode === null) {
        return '';
    }

    return `exit ${entry.exitCode}`;
};

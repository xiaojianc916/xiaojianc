import { nextTick, ref, type Ref } from 'vue';

import type { IAiCodeActionRequest } from '@/types/ai';
import type { IAiCodePathTarget } from '@/types/ai-code';
import type { IAiDiffEditorPreview } from '@/types/ai-patch';
import type { IScriptDiagnostic } from '@/types/editor';

export type TTitlebarExpose = {
    openCommandPalette: () => void;
};

export type TRunPanelExpose = {
    openShellCheck: () => void;
};

type TAiCodeActionEditorExpose = {
    runAiCodeAction: (kind: IAiCodeActionRequest['kind']) => void | Promise<void>;
};

interface IUseShellWorkbenchAiBridgeOptions {
    editorRef: Ref<unknown>;
    getWorkspaceRootPath: () => string | null;
    openDocumentByPath: (path: string) => Promise<void>;
    openAiDiffPreview: (preview: IAiDiffEditorPreview) => void;
    openTerminal: () => Promise<void>;
    handleSelectDiagnostic: (line: number, column: number) => void;
}

const ABSOLUTE_FILE_SYSTEM_PATH_PATTERN = /^(?:[a-zA-Z]:[\\/]|[\\/])/;

const trimTrailingPathSeparators = (value: string): string =>
    value.replace(/[\\/]+$/, '');

const trimLeadingPathSeparators = (value: string): string =>
    value.replace(/^[\\/]+/, '');

export const useShellWorkbenchAiBridge = (options: IUseShellWorkbenchAiBridgeOptions) => {
    const titlebarRef = ref<TTitlebarExpose | null>(null);
    const runPanelRef = ref<TRunPanelExpose | null>(null);

    const getAiCodeActionEditor = (): TAiCodeActionEditorExpose | null => {
        const candidate = options.editorRef.value as Partial<TAiCodeActionEditorExpose> | null | undefined;

        if (typeof candidate?.runAiCodeAction !== 'function') {
            return null;
        }

        return candidate as TAiCodeActionEditorExpose;
    };

    const runAiCodeAction = (kind: IAiCodeActionRequest['kind']): void => {
        void getAiCodeActionEditor()?.runAiCodeAction(kind);
    };

    const handleOpenCommandPalette = (): void => {
        titlebarRef.value?.openCommandPalette();
    };

    const handleAiCodeAction = (kind: IAiCodeActionRequest['kind']): void => {
        runAiCodeAction(kind);
    };

    const handleAiFixDiagnostic = (diagnostic: IScriptDiagnostic): void => {
        options.handleSelectDiagnostic(diagnostic.line, diagnostic.column);
        runAiCodeAction('fix_diagnostic');
    };

    const handleOpenShellCheck = async (): Promise<void> => {
        await options.openTerminal();
        runPanelRef.value?.openShellCheck();
    };

    const resolveAiCodePath = (path: string): string => {
        const workspaceRootPath = options.getWorkspaceRootPath();
        if (ABSOLUTE_FILE_SYSTEM_PATH_PATTERN.test(path) || !workspaceRootPath) {
            return path;
        }

        const separator = workspaceRootPath.includes('/') ? '/' : '\\';

        return [
            trimTrailingPathSeparators(workspaceRootPath),
            trimLeadingPathSeparators(path),
        ].join(separator);
    };

    const handleOpenAiCodePath = async (target: IAiCodePathTarget): Promise<void> => {
        if (target.kind === 'ai-diff') {
            if (!target.diffRef) {
                return;
            }

            const previewId = `ai-diff:${target.diffRef}`;
            options.openAiDiffPreview({
                id: previewId,
                title: target.title ?? `${target.path} (AI Diff)`,
                filePath: target.path,
                diffRef: target.diffRef,
                ...(target.patchRef ? { patchRef: target.patchRef } : {}),
                ...(target.runId ? { runId: target.runId } : {}),
                ...(target.stepId ? { stepId: target.stepId } : {}),
                hunks: [],
            });
            return;
        }

        await options.openDocumentByPath(resolveAiCodePath(target.path));

        if (target.startLine) {
            await nextTick();
            options.handleSelectDiagnostic(target.startLine, 1);
        }
    };

    return {
        titlebarRef,
        runPanelRef,
        handleOpenCommandPalette,
        handleAiCodeAction,
        handleAiFixDiagnostic,
        handleOpenShellCheck,
        handleOpenAiCodePath,
    };
};

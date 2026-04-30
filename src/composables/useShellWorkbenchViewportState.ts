import { computed, ref, type Ref } from 'vue';

const clampNumber = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value));

const resolveDiagnosticsPanelWidth = (availableWidth: number): number => {
    const normalizedWidth = Math.max(0, Math.round(availableWidth));
    if (normalizedWidth <= 0) {
        return 0;
    }

    const inset = normalizedWidth >= 960 ? 24 : 16;
    const hardMaxWidth = Math.max(0, normalizedWidth - inset);
    if (hardMaxWidth <= 0) {
        return normalizedWidth;
    }

    const sizeStrategy =
        normalizedWidth >= 1680
            ? { ratio: 0.28, minWidth: 320, softMaxWidth: 460 }
            : normalizedWidth >= 1440
                ? { ratio: 0.3, minWidth: 300, softMaxWidth: 440 }
                : normalizedWidth >= 1200
                    ? { ratio: 0.32, minWidth: 280, softMaxWidth: 420 }
                    : normalizedWidth >= 960
                        ? { ratio: 0.34, minWidth: 260, softMaxWidth: 400 }
                        : normalizedWidth >= 760
                            ? { ratio: 0.38, minWidth: 220, softMaxWidth: 360 }
                            : { ratio: 0.46, minWidth: 180, softMaxWidth: 320 };

    const resolvedMaxWidth = Math.min(hardMaxWidth, sizeStrategy.softMaxWidth);
    const resolvedMinWidth = Math.min(sizeStrategy.minWidth, resolvedMaxWidth);
    const preferredWidth = Math.round(normalizedWidth * sizeStrategy.ratio);

    return clampNumber(preferredWidth, resolvedMinWidth, resolvedMaxWidth);
};

interface IUseShellWorkbenchViewportStateOptions {
    editorViewportRef: Ref<HTMLElement | null>;
}

export const useShellWorkbenchViewportState = (
    options: IUseShellWorkbenchViewportStateOptions,
) => {
    const editorViewportWidth = ref(0);
    const diagnosticsTransitionsEnabled = ref(true);

    let editorViewportResizeObserver: ResizeObserver | null = null;
    let diagnosticsResizeSettleTimerId: number | null = null;
    let editorViewportResizeFrameId: number | null = null;
    let previousEditorViewportSize = { width: 0, height: 0 };
    let pendingEditorViewportSize: { width: number; height: number } | null = null;
    let isShellWindowResizing = false;

    const diagnosticsPanelMotionClass = computed(() =>
        diagnosticsTransitionsEnabled.value
            ? 'transition-[opacity,transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'
            : 'transition-none',
    );

    const diagnosticsPanelStyle = computed(() => {
        const availableWidth = editorViewportWidth.value;
        if (availableWidth <= 0) {
            return undefined;
        }

        const resolvedWidth = resolveDiagnosticsPanelWidth(availableWidth);
        return {
            width: `${resolvedWidth}px`,
            maxWidth: '100%',
        };
    });

    const scheduleDiagnosticsTransitionRestore = (): void => {
        if (diagnosticsResizeSettleTimerId !== null) {
            window.clearTimeout(diagnosticsResizeSettleTimerId);
        }

        diagnosticsResizeSettleTimerId = window.setTimeout(() => {
            diagnosticsTransitionsEnabled.value = true;
            diagnosticsResizeSettleTimerId = null;
        }, 140);
    };

    const handleEditorViewportResize = (width: number, height: number): void => {
        const normalizedWidth = Math.round(width);
        const normalizedHeight = Math.round(height);

        if (normalizedWidth <= 0 || normalizedHeight <= 0) {
            return;
        }

        if (editorViewportWidth.value !== normalizedWidth) {
            editorViewportWidth.value = normalizedWidth;
        }

        if (
            previousEditorViewportSize.width === normalizedWidth &&
            previousEditorViewportSize.height === normalizedHeight
        ) {
            return;
        }

        previousEditorViewportSize = { width: normalizedWidth, height: normalizedHeight };
        diagnosticsTransitionsEnabled.value = false;
        scheduleDiagnosticsTransitionRestore();
    };

    const flushEditorViewportResize = (): void => {
        editorViewportResizeFrameId = null;
        if (!pendingEditorViewportSize) {
            return;
        }

        const { width, height } = pendingEditorViewportSize;
        pendingEditorViewportSize = null;
        handleEditorViewportResize(width, height);
    };

    const queueEditorViewportResize = (width: number, height: number): void => {
        pendingEditorViewportSize = {
            width: Math.round(width),
            height: Math.round(height),
        };

        if (isShellWindowResizing) {
            return;
        }

        if (editorViewportResizeFrameId !== null) {
            return;
        }

        editorViewportResizeFrameId = window.requestAnimationFrame(flushEditorViewportResize);
    };

    const handleShellWindowResizeStart = (): void => {
        isShellWindowResizing = true;
        diagnosticsTransitionsEnabled.value = false;

        if (diagnosticsResizeSettleTimerId !== null) {
            window.clearTimeout(diagnosticsResizeSettleTimerId);
            diagnosticsResizeSettleTimerId = null;
        }
    };

    const handleShellWindowResizeEnd = (): void => {
        if (options.editorViewportRef.value) {
            pendingEditorViewportSize = {
                width: Math.round(options.editorViewportRef.value.clientWidth),
                height: Math.round(options.editorViewportRef.value.clientHeight),
            };
        }
    };

    const handleShellWindowResizeSettled = (): void => {
        isShellWindowResizing = false;

        if (editorViewportResizeFrameId !== null) {
            window.cancelAnimationFrame(editorViewportResizeFrameId);
            editorViewportResizeFrameId = null;
        }

        if (options.editorViewportRef.value) {
            pendingEditorViewportSize = {
                width: Math.round(options.editorViewportRef.value.clientWidth),
                height: Math.round(options.editorViewportRef.value.clientHeight),
            };
        }

        flushEditorViewportResize();
        scheduleDiagnosticsTransitionRestore();
    };

    const mount = (): void => {
        if (options.editorViewportRef.value) {
            previousEditorViewportSize = {
                width: options.editorViewportRef.value.clientWidth,
                height: options.editorViewportRef.value.clientHeight,
            };
            editorViewportWidth.value = options.editorViewportRef.value.clientWidth;
        }

        if (typeof ResizeObserver !== 'undefined' && options.editorViewportRef.value) {
            editorViewportResizeObserver = new ResizeObserver((entries) => {
                const targetEntry = entries[0];
                if (!targetEntry) {
                    return;
                }

                queueEditorViewportResize(targetEntry.contentRect.width, targetEntry.contentRect.height);
            });
            editorViewportResizeObserver.observe(options.editorViewportRef.value);
        }
    };

    const cleanup = (): void => {
        editorViewportResizeObserver?.disconnect();
        editorViewportResizeObserver = null;

        if (editorViewportResizeFrameId !== null) {
            window.cancelAnimationFrame(editorViewportResizeFrameId);
            editorViewportResizeFrameId = null;
        }

        if (diagnosticsResizeSettleTimerId !== null) {
            window.clearTimeout(diagnosticsResizeSettleTimerId);
            diagnosticsResizeSettleTimerId = null;
        }
    };

    return {
        editorViewportWidth,
        diagnosticsTransitionsEnabled,
        diagnosticsPanelMotionClass,
        diagnosticsPanelStyle,
        handleShellWindowResizeStart,
        handleShellWindowResizeEnd,
        handleShellWindowResizeSettled,
        mount,
        cleanup,
    };
};

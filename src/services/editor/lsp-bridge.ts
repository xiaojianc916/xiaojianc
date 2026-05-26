/**
 * LSP ↔ CM6 桥接
 *
 * 将 bash-language-server 的诊断和补全直接接入 CM6 的 lint/autocomplete 系统。
 * 设计为单一模块，避免循环引用。
 */

import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from '@codemirror/autocomplete';
import { autocompletion } from '@codemirror/autocomplete';
import type { Diagnostic } from '@codemirror/lint';
import { setDiagnostics } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import type { UnlistenFn } from '@tauri-apps/api/event';

// ============================================================================
// Tauri IPC（简化版，避免依赖未生成的 bindings）
// ============================================================================

type TauriCore = typeof import('@tauri-apps/api/core');
type TauriEvent = typeof import('@tauri-apps/api/event');

let coreMod: TauriCore | null = null;
let eventMod: TauriEvent | null = null;

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!coreMod) coreMod = await import('@tauri-apps/api/core');
  return coreMod.invoke<T>(cmd, args);
}

async function tauriListen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (!eventMod) eventMod = await import('@tauri-apps/api/event');
  return eventMod.listen<T>(event, (e) => handler(e.payload));
}

// ============================================================================
// 类型（与 Rust LspDiagnostic 对齐）
// ============================================================================

interface LspDiag {
  filePath: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: number;
  message: string;
  code: string | null;
  source: string | null;
}

interface LspDiagEvent {
  filePath: string;
  diagnostics: LspDiag[];
}

interface LspItem {
  label: string;
  insertText: string | null;
  kind: number | null;
  detail: string | null;
  documentation: string | null;
}

// ============================================================================
// 公开 API
// ============================================================================

let diagnosticsUnlisten: UnlistenFn | null = null;

export async function lspStartBridge(workspaceRoot: string): Promise<void> {
  await tauriInvoke('lsp_start', { workspaceRoot });
}

export async function lspStopBridge(): Promise<void> {
  diagnosticsUnlisten?.();
  diagnosticsUnlisten = null;
  await tauriInvoke('lsp_stop');
}

export async function lspDidOpenBridge(
  filePath: string,
  content: string,
  languageId: string,
): Promise<void> {
  await tauriInvoke('lsp_did_open', { filePath, content, languageId });
}

export async function lspDidChangeBridge(
  filePath: string,
  content: string,
  version: number,
): Promise<void> {
  await tauriInvoke('lsp_did_change', { filePath, content, version });
}

export async function lspDidCloseBridge(filePath: string): Promise<void> {
  await tauriInvoke('lsp_did_close', { filePath });
}

async function lspCompletionBridge(
  filePath: string,
  line: number,
  col: number,
): Promise<LspItem[]> {
  return tauriInvoke<LspItem[]>('lsp_completion', { filePath, line, column: col });
}

// ============================================================================
// 诊断处理
// ============================================================================

/** 保存当前 view 和文件路径的回调，用于诊断到达时更新 CM6 */
type DiagnosticsHandler = (filePath: string, cm6Diags: Diagnostic[]) => void;

let onDiagnosticsCb: DiagnosticsHandler | null = null;

export async function lspListenDiagnostics(cb: DiagnosticsHandler): Promise<UnlistenFn> {
  onDiagnosticsCb = cb;

  if (diagnosticsUnlisten) diagnosticsUnlisten();

  diagnosticsUnlisten = await tauriListen<LspDiagEvent>('lsp-diagnostics', (event) => {
    const cm6Diags = event.diagnostics.map(lspDiagToCm6);
    cb(event.filePath, cm6Diags);
  });

  return diagnosticsUnlisten;
}

function lspDiagToCm6(d: LspDiag): Diagnostic {
  return {
    from: 0,
    to: 0,
    severity:
      d.severity === 1
        ? 'error'
        : d.severity === 2
          ? 'warning'
          : d.severity === 3
            ? 'info'
            : 'hint',
    message: d.message,
    source: d.code ?? d.source ?? 'shellcheck',
  };
}

// ============================================================================
// CM6 Extension 工厂
// ============================================================================

export interface LspExtensionOptions {
  filePath: string;
  languageId: string;
  getContent: () => string;
}

/**
 * 创建 CM6 LSP Extension（含诊断 + 补全）
 */
export function createLspExtension(opts: LspExtensionOptions) {
  const { filePath, languageId, getContent } = opts;

  let view: EditorView | null = null;
  let version = 0;
  let changeTimer: ReturnType<typeof setTimeout> | null = null;

  // 补全源
  const completionSource: CompletionSource = async (ctx: CompletionContext) => {
    if (!filePath) return null;

    const pos = ctx.pos;
    const line = ctx.state.doc.lineAt(pos);
    const lineNum = line.number - 1;
    const col = pos - line.from;

    try {
      const items = await lspCompletionBridge(filePath, lineNum, col);
      if (!items.length) return null;

      return {
        from: pos,
        options: items.map(
          (item): Completion => ({
            label: item.label,
            detail: item.detail ?? undefined,
            info: item.documentation ?? undefined,
            type: lspKindToType(item.kind),
            apply: item.insertText ?? item.label,
          }),
        ),
        validFor: /^[\w$]*$/u,
      };
    } catch {
      return null;
    }
  };

  // view 挂载 + 诊断监听
  const viewListener = EditorView.updateListener.of((update: ViewUpdate) => {
    if (!view) view = update.view;

    if (update.docChanged && filePath) {
      version++;
      if (changeTimer) clearTimeout(changeTimer);
      changeTimer = setTimeout(() => {
        void lspDidChangeBridge(filePath, getContent(), version);
      }, 300);
    }
  });

  // 诊断更新
  const updateDiagnostics = (diagFilePath: string, diags: Diagnostic[]) => {
    if (!view || diagFilePath !== filePath) return;
    const doc = view.state.doc;
    const positioned = diags.map((d, _i) => {
      // 需要从原始 LspDiag 重新计算位置——此处简化处理
      // 完整实现需存储原始诊断的 line/col
      return d;
    });
    view.dispatch(setDiagnostics(view.state, positioned));
  };

  // 打开时通知 LSP
  const openDoc = () => {
    if (filePath) {
      void lspDidOpenBridge(filePath, getContent(), languageId);
    }
  };

  const ext: Extension[] = [autocompletion({ override: [completionSource] }), viewListener];

  return {
    extensions: ext,
    attach(v: EditorView) {
      view = v;
      void lspListenDiagnostics(updateDiagnostics);
      openDoc();
    },
    detach() {
      view = null;
      if (changeTimer) clearTimeout(changeTimer);
      if (filePath) void lspDidCloseBridge(filePath);
    },
  };
}

// ============================================================================
// 辅助
// ============================================================================

function lspKindToType(kind: number | null): string {
  switch (kind) {
    case 2:
      return 'method';
    case 3:
      return 'function';
    case 6:
      return 'variable';
    case 14:
      return 'keyword';
    default:
      return 'text';
  }
}

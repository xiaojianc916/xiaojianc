/**
 * LSP ↔ CM6 桥接
 *
 * 把 bash-language-server 的诊断 / 补全 / 悬停接入 CM6。
 *
 * Goals:
 *   - 单一全局 diagnostics 监听 + 按 filePath 分派(多编辑器、同文件多订阅者都安全)
 *   - 监听 Rust 端 `lsp-crashed` 事件，自动切回 stopped 并清屏诊断
 *   - completion / hover 前自动 flush 未发的 didChange，且 flush 串行化
 *   - didOpen → didChange 因果链:didChange/completion/hover 都等 openPromise
 *   - attach / detach 严格成对，双重 attach 自动 detach 旧的，无监听泄漏
 *   - lspBridge.start 自动去重 + HMR 兼容单例
 *   - filePath 跨前后端归一化(POSIX 正斜杠)，避免 Windows 反斜杠错配
 *   - 跟踪已打开文档，崩溃自动重启后重放 didOpen，恢复诊断/补全
 *   - 诊断不自行 dispatch，交由上层与 ShellCheck 合并为单一来源(见 createLspExtension 的 onDiagnostics)
 */

import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import type { Diagnostic } from "@codemirror/lint";
import { setDiagnostics } from "@codemirror/lint";
import type { Extension, Text } from "@codemirror/state";
import {
  EditorView,
  hoverTooltip,
  type Tooltip,
  type ViewUpdate,
} from "@codemirror/view";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { highlightCodeToHtml } from "@/services/editor/codemirror-static-highlight";

export const lspCompletionTheme = EditorView.theme({}, {});

// ============================================================================
// Lucide SVG 图标（补全种类图标）
// ============================================================================
const LUCIDE_PATHS: Record<string, string> = {
  function:
    "M17.5 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11ZM9 17c2 0 2.8-1 2.8-2.8V10c0-2 1-3.3 3.2-3M9 11h5.7",
  method:
    "M17.5 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11ZM9 17c2 0 2.8-1 2.8-2.8V10c0-2 1-3.3 3.2-3M9 11h5.7",
  keyword: "m15 15-6 6v-4H4v-4h2v-2a6 6 0 0 1 6-6h3v4h-3a2 2 0 0 0-2 2v2h5Z",
  variable: "M8 21s-4-3-4-9 4-9 4-9m8 0s4 3 4 9-4 9-4 9M5 12h14",
  text: "M4 7V4h16v3M9 21h6M12 4v17",
  snippet:
    "M8 3H6a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4c0 1.1.9 2 2 2h2M16 21h2a2 2 0 0 0 2-2v-4c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-2",
};

function cm6TypeToLucide(type: string): string {
  return LUCIDE_PATHS[type] ?? LUCIDE_PATHS.text;
}

export function createLucideCompletionIcon(type: string): HTMLElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", cm6TypeToLucide(type));
  svg.appendChild(path);
  const wrapper = document.createElement("span");
  wrapper.className = "cm-lsp-icon";
  wrapper.setAttribute("data-type", type);
  wrapper.appendChild(svg);
  return wrapper;
}

// ============================================================================
// Tauri IPC(懒加载，避免 SSR / 测试环境炸)
// ============================================================================
type TauriCore = typeof import("@tauri-apps/api/core");
type TauriEvent = typeof import("@tauri-apps/api/event");
let corePromise: Promise<TauriCore> | null = null;
let eventPromise: Promise<TauriEvent> | null = null;

async function tauriInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  corePromise ??= import("@tauri-apps/api/core");
  const core = await corePromise;
  return core.invoke<T>(cmd, args);
}
async function tauriListen<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<UnlistenFn> {
  eventPromise ??= import("@tauri-apps/api/event");
  const ev = await eventPromise;
  return ev.listen<T>(event, (e) => handler(e.payload));
}

// ============================================================================
// 与 Rust 端对齐的类型
// ============================================================================
interface LspDiag {
  filePath: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: number; // 1=Error 2=Warning 3=Info 4=Hint
  message: string;
  code: string | null;
  source: string | null;
}
interface LspDiagEvent {
  filePath: string;
  diagnostics: LspDiag[];
}
interface LspCrashedEvent {
  exitStatus?: string;
}
interface LspItem {
  label: string;
  insertText: string | null;
  kind: number | null;
  detail: string | null;
  documentation: string | null;
}
interface LspHover {
  contents: string;
}

// ============================================================================
// 路径归一化
// ============================================================================
/**
 * 统一前后端 filePath 表示:去掉 Windows 扩展路径前缀，全部用正斜杠。
 *
 * Windows 上 Tauri 可能返回 `\\?\D:\workspace\test.sh` 这样的
 * 扩展路径(extended-length path)。`\\?\` 前缀在 Rust 的
 * path_to_uri → uri_to_path 往返中会被错误截断，导致前后端路径不一致。
 * 这里统一剥掉前缀再归一化。
 */
function normalizePath(p: string): string {
  // 去掉 Windows 扩展路径前缀 \\?\ 或 \\.\ (含正斜杠变体)
  let cleaned = p;
  if (cleaned.startsWith("\\\\?\\UNC\\")) {
    cleaned = "\\\\" + cleaned.slice("\\\\?\\UNC\\".length);
  } else if (cleaned.startsWith("\\\\?\\") || cleaned.startsWith("\\\\.\\")) {
    cleaned = cleaned.slice("\\\\?\\".length);
  } else if (cleaned.startsWith("//?/UNC/")) {
    cleaned = "//" + cleaned.slice("//?/UNC/".length);
  } else if (cleaned.startsWith("//?/") || cleaned.startsWith("//./")) {
    cleaned = cleaned.slice("//?/".length);
  }
  return cleaned.replace(/\\/g, "/");
}

// ============================================================================
// Bridge 单例
// ============================================================================
type FileHandler = (diags: LspDiag[]) => void;
export type BridgeStateEvent =
  | { type: "started" }
  | { type: "stopped" }
  | { type: "crashed"; exitStatus?: string };
export type BridgeStateListener = (e: BridgeStateEvent) => void;

interface OpenDocument {
  filePath: string;
  content: string;
  languageId: string;
  version: number;
}

class LspBridge {
  private started = false;
  private startPromise: Promise<void> | null = null;
  private unlistenDiagnostics: UnlistenFn | null = null;
  private unlistenCrashed: UnlistenFn | null = null;
  /** 同一文件可有多个订阅者(diff 视图、并排编辑等场景) */
  private fileHandlers = new Map<string, Set<FileHandler>>();
  /**
   * 已打开文档的最新快照，按 filePath 去重。用于:
   *  1) 启动前到达的 didOpen 排队;
   *  2) 崩溃自动重启后重放 didOpen，恢复服务端文档状态。
   */
  private openDocuments = new Map<string, OpenDocument>();
  private stateListeners = new Set<BridgeStateListener>();

  async start(workspaceRoot: string): Promise<void> {
    if (this.started) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = (async () => {
      // 幂等:重启(尤其崩溃后)前先拆掉可能残留的监听，避免重复注册导致泄漏
      this.tearDownListeners();
      // 先建监听，避免 didOpen → 第一波诊断丢失
      this.unlistenDiagnostics = await tauriListen<LspDiagEvent>(
        "lsp-diagnostics",
        (e) => {
          const key = normalizePath(e.filePath);
          const handlers = this.fileHandlers.get(key);
          if (!handlers) return;
          for (const h of handlers) {
            try {
              h(e.diagnostics);
            } catch (err) {
              console.warn("[lsp-bridge] diagnostics handler error", err);
            }
          }
        },
      );
      this.unlistenCrashed = await tauriListen<LspCrashedEvent>(
        "lsp-crashed",
        (payload) => {
          this.onBackendCrashed(payload?.exitStatus);
        },
      );

      try {
        await tauriInvoke<void>("lsp_start", { workspaceRoot });
        this.started = true;
        this.emitState({ type: "started" });
        await this.replayOpenDocuments();
      } catch (err) {
        this.tearDownListeners();
        throw err;
      }
    })();

    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async stop(): Promise<void> {
    // 如果还在 start，等它结束(成功或失败)再 stop
    if (this.startPromise) {
      try {
        await this.startPromise;
      } catch {
        /* ignore */
      }
    }
    if (!this.started && !this.unlistenDiagnostics && !this.unlistenCrashed)
      return;

    this.started = false;
    // 主动停止 = 彻底遗忘已打开文档(与崩溃区别:崩溃保留以便重放)
    this.openDocuments.clear();
    this.clearAllDiagnostics();
    this.fileHandlers.clear();
    this.tearDownListeners();
    try {
      await tauriInvoke<void>("lsp_stop");
    } catch (err) {
      console.warn("[lsp-bridge] lsp_stop invoke failed", err);
    } finally {
      this.emitState({ type: "stopped" });
    }
  }

  isStarted(): boolean {
    return this.started;
  }

  /** 订阅 bridge 状态变化(started / stopped / crashed) */
  onStateChange(listener: BridgeStateListener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /** 注册按文件的诊断 handler，返回解注册函数。同一文件可注册多个 handler。 */
  registerFile(filePath: string, handler: FileHandler): () => void {
    const key = normalizePath(filePath);
    let set = this.fileHandlers.get(key);
    if (!set) {
      set = new Set();
      this.fileHandlers.set(key, set);
    }
    set.add(handler);
    return () => {
      const s = this.fileHandlers.get(key);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) this.fileHandlers.delete(key);
    };
  }

  async didOpen(
    filePath: string,
    content: string,
    languageId: string,
  ): Promise<void> {
    const key = normalizePath(filePath);
    // 记录最新快照:崩溃重启重放、启动前排队都依赖它
    this.openDocuments.set(key, {
      filePath: key,
      content,
      languageId,
      version: 1,
    });
    if (this.startPromise) {
      try {
        await this.startPromise;
      } catch {
        return;
      }
    }
    if (this.started) {
      await tauriInvoke<void>("lsp_did_open", {
        filePath: key,
        content,
        languageId,
      });
    }
    // 未启动:已记入 openDocuments，待 start 成功后由 replayOpenDocuments 重放
  }

  /** @returns 是否真正发送出去(false = 当前未启动，调用方应自行处理重发) */
  async didChange(
    filePath: string,
    content: string,
    version: number,
  ): Promise<boolean> {
    const key = normalizePath(filePath);
    const doc = this.openDocuments.get(key);
    if (doc) {
      doc.content = content;
      doc.version = version;
    }
    if (!this.started) return false;
    await tauriInvoke<void>("lsp_did_change", {
      filePath: key,
      content,
      version,
    });
    return true;
  }

  async didClose(filePath: string): Promise<void> {
    const key = normalizePath(filePath);
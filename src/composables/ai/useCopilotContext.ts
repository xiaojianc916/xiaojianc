/**
 * useCopilotContext — exposes editor state to the AI agent via CopilotKit's
 * `useCopilotReadable`. Replaces manual context building in useAiAssistant.
 *
 * All readables are reactive (Vue computed). Truncation limits are
 * centralised in `CONTEXT_LIMITS`. Descriptions are i18n-ready via the
 * optional `messages` override.
 */
import { useCopilotReadable } from '@copilotkit/vue';
import { computed, type Ref } from 'vue';

import type {
  IActiveRunSummary,
  IAnalyzeScriptPayload,
  IEditorDocument,
  IEditorSelectionSummary,
} from '@/types/editor';
import type { IGitRepositoryStatusPayload } from '@/types/git';

// ---------------------------------------------------------------------------
// Limits & messages (centralised, overridable)
// ---------------------------------------------------------------------------
export const CONTEXT_LIMITS = {
  documentChars: 8_000,
  selectionChars: 4_000,
  gitFiles: 30,
} as const;

export const DEFAULT_CONTEXT_MESSAGES = {
  documentDesc: '当前编辑器中打开的文件内容及元信息',
  selectionDesc: '用户在编辑器中选中的文本（如有）',
  gitDesc: '当前工作区 Git 仓库变更状态',
  activeRunDesc: '当前正在运行的脚本信息（如有）',
  workspaceDesc: '当前工作区根目录路径',
  analysisDesc: '当前文件的脚本静态分析结果',

  unsavedPath: '(未保存)',
  noSelection: '无选中文本',
  noGitChanges: '无变更',
  gitUnavailable: '当前工作区不是 Git 仓库',
  noActiveRun: '无运行中的脚本',
  noWorkspace: '(未打开工作区)',
  truncatedSuffix: (totalChars: number) => `\n\n[内容已截断，总长 ${totalChars} 字符]`,
  truncatedFiles: (hidden: number) => `\n\n[另有 ${hidden} 个文件未列出]`,
} as const;

export type ContextMessages = typeof DEFAULT_CONTEXT_MESSAGES;

// ---------------------------------------------------------------------------
// Safe slicing (avoids breaking UTF-16 surrogate pairs)
// ---------------------------------------------------------------------------
const safeSlice = (str: string, max: number): string => {
  if (str.length <= max) return str;
  let end = max;
  // If we land on a high surrogate, step back one code unit.
  const code = str.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return str.slice(0, end);
};

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------
const formatDocumentContext = (
  doc: IEditorDocument,
  messages: ContextMessages,
): Record<string, unknown> => {
  const content = doc.content ?? '';
  const trimmed =
    content.length > CONTEXT_LIMITS.documentChars
      ? safeSlice(content, CONTEXT_LIMITS.documentChars) + messages.truncatedSuffix(content.length)
      : content;

  return {
    path: doc.path ?? messages.unsavedPath,
    name: doc.name,
    lineCount: doc.lineCount,
    isDirty: doc.isDirty,
    content: trimmed,
  };
};

const formatSelectionContext = (
  selection: IEditorSelectionSummary | null,
): Record<string, unknown> | null => {
  if (!selection?.text) return null;
  return {
    selectedText: safeSlice(selection.text, CONTEXT_LIMITS.selectionChars),
    startLine: selection.startLine,
    endLine: selection.endLine,
  };
};

const formatGitContext = (
  git: IGitRepositoryStatusPayload,
  messages: ContextMessages,
): Record<string, unknown> | string => {
  if (!git.available) return messages.gitUnavailable;
  if (git.isClean) return messages.noGitChanges;

  const totalFiles = git.files.length;
  const shownFiles = git.files.slice(0, CONTEXT_LIMITS.gitFiles).map((f) => ({
    path: f.path,
    index: f.indexStatus,
    worktree: f.worktreeStatus,
    untracked: f.isUntracked,
  }));

  return {
    stagedCount: git.stagedCount,
    unstagedCount: git.unstagedCount,
    untrackedCount: git.untrackedCount,
    conflictedCount: git.conflictedCount,
    files: shownFiles,
    ...(totalFiles > CONTEXT_LIMITS.gitFiles && {
      note: messages.truncatedFiles(totalFiles - CONTEXT_LIMITS.gitFiles).trim(),
    }),
  };
};

const formatActiveRunContext = (
  run: IActiveRunSummary | null,
  messages: ContextMessages,
): Record<string, unknown> | string => {
  if (!run) return messages.noActiveRun;
  return {
    documentName: run.documentName,
    executor: run.executorLabel,
    runId: run.runId,
  };
};

const formatAnalysisContext = (
  analysis: IAnalyzeScriptPayload | null | undefined,
): Record<string, unknown> | null => {
  if (!analysis) return null;
  // Pass through — assumes IAnalyzeScriptPayload is already serialisable.
  // Replace with explicit field whitelist if it contains heavy fields.
  return { ...analysis };
};

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------
export interface IUseCopilotContextOptions {
  document: Ref<IEditorDocument>;
  activeRun: Ref<IActiveRunSummary | null>;
  analysis: Ref<IAnalyzeScriptPayload>;
  selection: Ref<IEditorSelectionSummary | null>;
  gitStatus: Ref<IGitRepositoryStatusPayload>;
  workspaceRootPath: Ref<string | null>;
  /** Optional i18n / wording override. */
  messages?: Partial<ContextMessages>;
}

export const useCopilotContext = (options: IUseCopilotContextOptions): void => {
  const messages: ContextMessages = {
    ...DEFAULT_CONTEXT_MESSAGES,
    ...options.messages,
  };

  // 1. Document
  useCopilotReadable({
    description: messages.documentDesc,
    value: computed(() => formatDocumentContext(options.document.value, messages)),
  });

  // 2. Selection
  useCopilotReadable({
    description: messages.selectionDesc,
    value: computed(() => formatSelectionContext(options.selection.value) ?? messages.noSelection),
  });

  // 3. Git status
  useCopilotReadable({
    description: messages.gitDesc,
    value: computed(() => formatGitContext(options.gitStatus.value, messages)),
  });

  // 4. Active run
  useCopilotReadable({
    description: messages.activeRunDesc,
    value: computed(() => formatActiveRunContext(options.activeRun.value, messages)),
  });

  // 5. Workspace root
  useCopilotReadable({
    description: messages.workspaceDesc,
    value: computed(() => options.workspaceRootPath.value ?? messages.noWorkspace),
  });

  // 6. Script analysis (previously declared but unused)
  useCopilotReadable({
    description: messages.analysisDesc,
    value: computed(() => formatAnalysisContext(options.analysis.value)),
  });
};

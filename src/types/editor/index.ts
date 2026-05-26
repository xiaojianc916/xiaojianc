import type {
  AnalyzeScriptPayload,
  AnalyzeScriptRequest,
  DocumentEncoding,
  ExecutionEnvironment,
  ExecutionOption,
  ExecutorKind,
  FormatScriptPayload,
  FormatScriptRequest,
  ImageAssetPayload,
  SaveScriptRequest,
  ScriptDiagnosticPayload,
  ScriptDiagnosticSeverity,
  ScriptFilePayload,
  WorkspaceDirectoryPayload,
  WorkspaceEntry,
  WorkspacePathCreatePayload,
  WorkspacePathCreateRequest,
  WorkspacePathDeletePayload,
  WorkspacePathDeleteRequest,
  WorkspacePathRenamePayload,
  WorkspacePathRenameRequest,
} from '@/bindings/tauri';
import type { IAiDiffEditorPreview } from '@/types/ai/patch';
import type { IGitDiffPreviewPayload } from '@/types/git';

export type TDocumentEncoding = DocumentEncoding;

export type TDocumentKind = 'text' | 'image' | 'ai-diff' | 'git-diff';
export type TExecutorKind = ExecutorKind;
export type TLogLevel = 'info' | 'success' | 'error';
export type TRunLogScope = 'run' | 'workspace' | 'editor' | 'system';
export type TScriptDiagnosticSeverity = ScriptDiagnosticSeverity;
export type TRunHistoryStatus = 'success' | 'failed' | 'canceled';

export interface IEditorDocument {
  id: string;
  path: string | null;
  name: string;
  kind: TDocumentKind;
  content: string;
  encoding: TDocumentEncoding;
  savedContent: string;
  savedEncoding: TDocumentEncoding;
  isDirty: boolean;
  lineCount: number;
  charCount: number;
  aiDiffPreview?: IAiDiffEditorPreview;
  gitDiffPreview?: IGitDiffPreviewPayload;
}

export interface IWorkbenchOpenFileRequest {
  path: string;
  lineNumber?: number | null;
  column?: number | null;
}

export type TWorkbenchOpenFilePayload = string | IWorkbenchOpenFileRequest;

export interface ICommandTemplate {
  id: string;
  title: string;
  category: string;
  description: string;
  snippet: string;
  cursorOffset?: number;
}

export type IExecutionOption = ExecutionOption;

export type IExecutionEnvironment = ExecutionEnvironment;

export interface IRunLogEntry {
  id: string;
  level: TLogLevel;
  title: string;
  detail: string;
  createdAt: string;
  scope?: TRunLogScope;
  runId?: string | null;
  code?: string | null;
}

export interface IActiveRunSummary {
  runId: string;
  documentName: string;
  documentPath: string | null;
  commandLine: string;
  executor: TExecutorKind;
  executorLabel: string;
  startedAt: string;
  usedTempFile: boolean;
}

export interface IEditorSelectionSummary {
  text: string;
  startLine: number;
  endLine: number;
}

export interface IRunHistoryEntry {
  id: string;
  status: TRunHistoryStatus;
  documentName: string;
  documentPath: string | null;
  commandLine: string;
  executor: TExecutorKind;
  executorLabel: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number | null;
  usedTempFile: boolean;
}

export type IWorkspaceEntry = WorkspaceEntry;

export type IWorkspaceDirectoryPayload = WorkspaceDirectoryPayload;

export type IWorkspacePathCreateRequest = WorkspacePathCreateRequest;

export type IWorkspacePathCreatePayload = WorkspacePathCreatePayload;

export type IWorkspacePathRenameRequest = WorkspacePathRenameRequest;

export type IWorkspacePathRenamePayload = WorkspacePathRenamePayload;

export type IWorkspacePathDeleteRequest = WorkspacePathDeleteRequest;

export type IWorkspacePathDeletePayload = WorkspacePathDeletePayload;

export interface IRunResult {
  runId: string | null;
  success: boolean;
  stdout: string;
  stderr: string;
  combinedOutput: string;
  exitCode: number | null;
  executor: TExecutorKind;
  executorLabel: string;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  commandLine: string;
  logPath: string | null;
  usedTempFile: boolean;
}

export type IScriptDiagnostic = ScriptDiagnosticPayload;

export type IAnalyzeScriptRequest = AnalyzeScriptRequest;

export type IAnalyzeScriptPayload = AnalyzeScriptPayload;

export type IImageAssetPayload = ImageAssetPayload;

export type IScriptFilePayload = ScriptFilePayload;

export type ISaveScriptRequest = SaveScriptRequest;

export type IFormatScriptRequest = FormatScriptRequest;

export type IFormatScriptPayload = FormatScriptPayload;

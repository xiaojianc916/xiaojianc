import { tauriService } from '@/services/tauri';
import { useEditorStore } from '@/store/editor';
import { areFileSystemPathsEqual } from '@/utils/path';

import type { IEditorDocument, IScriptFilePayload } from '@/types/editor';

interface IRefreshSidecarChangedDocumentsRequest {
  changedFilePaths: readonly string[];
  hasFileMutations: boolean;
  workspaceRootPath?: string | null;
  currentDocument?: IEditorDocument | null;
}

export interface IRefreshSidecarChangedDocumentsResult {
  refreshedPaths: string[];
  skippedDirtyNames: string[];
  failedNames: string[];
}

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/u;
const UNC_ABSOLUTE_PATH_PATTERN = /^(?:\\\\|\/\/)/u;
const POSIX_ABSOLUTE_PATH_PATTERN = /^\//u;

const isAbsoluteFileSystemPath = (path: string): boolean =>
  WINDOWS_ABSOLUTE_PATH_PATTERN.test(path) ||
  UNC_ABSOLUTE_PATH_PATTERN.test(path) ||
  POSIX_ABSOLUTE_PATH_PATTERN.test(path);

const joinWorkspacePath = (workspaceRootPath: string, path: string): string => {
  const root = workspaceRootPath.replace(/[\\/]+$/u, '');
  const child = path.replace(/^[\\/]+/u, '');
  return `${root}/${child}`;
};

const resolveChangedFilePath = (
  path: string,
  workspaceRootPath: string | null | undefined,
): string => {
  const trimmed = path.trim();

  if (!trimmed) {
    return '';
  }

  if (isAbsoluteFileSystemPath(trimmed) || !workspaceRootPath) {
    return trimmed;
  }

  return joinWorkspacePath(workspaceRootPath, trimmed);
};

const appendUniquePath = (paths: string[], path: string): void => {
  if (!path || paths.some((item) => areFileSystemPathsEqual(item, path))) {
    return;
  }

  paths.push(path);
};

const buildCandidatePaths = (
  request: IRefreshSidecarChangedDocumentsRequest,
): string[] => {
  const rawPaths = request.changedFilePaths.length > 0
    ? request.changedFilePaths
    : request.currentDocument?.path
      ? [request.currentDocument.path]
      : [];
  const paths: string[] = [];

  for (const rawPath of rawPaths) {
    const trimmed = rawPath.trim();
    const resolved = resolveChangedFilePath(trimmed, request.workspaceRootPath);

    appendUniquePath(paths, trimmed);
    appendUniquePath(paths, resolved);
  }

  return paths;
};

const applyScriptPayloadToDocument = (
  document: IEditorDocument,
  payload: IScriptFilePayload,
): void => {
  document.path = payload.path;
  document.name = payload.name;
  document.kind = 'text';
  document.content = payload.content;
  document.encoding = payload.encoding;
  document.savedContent = payload.content;
  document.savedEncoding = payload.encoding;
  document.isDirty = false;
  document.lineCount = payload.lineCount;
  document.charCount = payload.charCount;
};

export const useSidecarChangedDocumentRefresh = () => {
  const editorStore = useEditorStore();

  const refreshSidecarChangedDocuments = async (
    request: IRefreshSidecarChangedDocumentsRequest,
  ): Promise<IRefreshSidecarChangedDocumentsResult> => {
    const result: IRefreshSidecarChangedDocumentsResult = {
      refreshedPaths: [],
      skippedDirtyNames: [],
      failedNames: [],
    };

    if (!request.hasFileMutations) {
      return result;
    }

    for (const path of buildCandidatePaths(request)) {
      const storeDocument = editorStore.findDocumentByPath(path);
      const fallbackDocument =
        request.currentDocument?.path && areFileSystemPathsEqual(request.currentDocument.path, path)
          ? request.currentDocument
          : null;
      const targetDocument = storeDocument ?? fallbackDocument;

      if (!targetDocument || targetDocument.kind !== 'text') {
        continue;
      }

      if (targetDocument.isDirty) {
        result.skippedDirtyNames.push(targetDocument.name);
        continue;
      }

      try {
        const payload = await tauriService.loadScript(targetDocument.path ?? path);
        if (storeDocument) {
          editorStore.applyDocumentPayload(storeDocument.id, payload);
        } else {
          applyScriptPayloadToDocument(targetDocument, payload);
        }
        result.refreshedPaths.push(payload.path);
      } catch {
        result.failedNames.push(targetDocument.name || path);
      }
    }

    return result;
  };

  return {
    refreshSidecarChangedDocuments,
  };
};

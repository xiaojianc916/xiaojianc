export type TGitChangeKind =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'typechange'
  | 'untracked'
  | 'conflicted';

export interface IGitCommitSummaryPayload {
  id: string;
  shortId: string;
  summary: string;
  authorName: string;
  authoredAt: string;
}

export interface IGitFileStatusPayload {
  path: string;
  relativePath: string;
  fileName: string;
  previousPath: string | null;
  previousRelativePath: string | null;
  indexStatus: TGitChangeKind | null;
  worktreeStatus: TGitChangeKind | null;
  isConflicted: boolean;
  isUntracked: boolean;
}

export interface IGitRepositoryStatusPayload {
  available: boolean;
  message: string | null;
  repositoryRootPath: string | null;
  repositoryName: string | null;
  gitDirPath: string | null;
  headBranchName: string | null;
  headShortName: string | null;
  headShortOid: string | null;
  isDetached: boolean;
  isClean: boolean;
  ahead: number;
  behind: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictedCount: number;
  files: IGitFileStatusPayload[];
  lastCommit: IGitCommitSummaryPayload | null;
}

export interface IGitFileBaselinePayload {
  available: boolean;
  message: string | null;
  repositoryRootPath: string | null;
  filePath: string;
  relativePath: string | null;
  isTracked: boolean;
  content: string | null;
}

export interface IGitPathOperationRequest {
  repositoryRootPath: string;
  paths: string[];
}

export interface IGitCommitRequest {
  repositoryRootPath: string;
  message: string;
}

export interface IGitCommitResultPayload {
  status: IGitRepositoryStatusPayload;
  commit: IGitCommitSummaryPayload;
}
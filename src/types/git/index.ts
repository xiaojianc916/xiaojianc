export type TGitChangeKind =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'typechange'
  | 'untracked'
  | 'conflicted';

export type TGitDiffMode = 'worktree' | 'staged';

export type TGitBranchKind = 'local' | 'remote';

export type TGitPullRequestProvider =
  | 'github'
  | 'gitlab'
  | 'gitea'
  | 'bitbucket'
  | 'unknown';

export interface IGitCommitSummaryPayload {
  id: string;
  shortId: string;
  summary: string;
  authorName: string;
  authoredAt: string;
}

export interface IGitCommitHistoryRequest {
  repositoryRootPath: string;
  offset?: number;
  limit?: number;
}

export interface IGitCommitHistoryPayload {
  entries: IGitCommitSummaryPayload[];
  hasMore: boolean;
  nextOffset: number | null;
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

export interface IGitBranchPayload {
  name: string;
  shorthand: string;
  kind: TGitBranchKind;
  upstreamName: string | null;
  isCurrent: boolean;
  isHead: boolean;
  ahead: number;
  behind: number;
  lastCommit: IGitCommitSummaryPayload | null;
}

export interface IGitBranchListPayload {
  branches: IGitBranchPayload[];
}

export interface IGitBranchCheckoutRequest {
  repositoryRootPath: string;
  branchName: string;
}

export interface IGitBranchCreateRequest {
  repositoryRootPath: string;
  branchName: string;
  checkout: boolean;
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

export interface IGitRepositoryRootRequest {
  repositoryRootPath: string;
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

export interface IGitStashEntryPayload {
  index: number;
  stashId: string;
  summary: string;
  branchName: string | null;
  commitShortId: string | null;
}

export interface IGitStashListPayload {
  entries: IGitStashEntryPayload[];
}

export interface IGitStashSaveRequest {
  repositoryRootPath: string;
  message: string | null;
  includeUntracked: boolean;
}

export interface IGitStashApplyRequest {
  repositoryRootPath: string;
  stashIndex: number;
  pop: boolean;
}

export interface IGitStashDropRequest {
  repositoryRootPath: string;
  stashIndex: number;
}

export interface IGitPullRequestSupportPayload {
  available: boolean;
  remoteName: string | null;
  provider: TGitPullRequestProvider;
  repositoryUrl: string | null;
  pullRequestsUrl: string | null;
  createPullRequestUrl: string | null;
}

export interface IGitDiffPreviewRequest {
  repositoryRootPath: string;
  path: string;
  mode: TGitDiffMode;
}

export interface IGitDiffPreviewPayload {
  id: string;
  repositoryRootPath: string;
  path: string;
  relativePath: string;
  title: string;
  mode: TGitDiffMode;
  originalContent: string;
  modifiedContent: string;
  isEmpty: boolean;
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

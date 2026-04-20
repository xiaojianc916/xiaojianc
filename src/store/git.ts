import { tauriService } from '@/services/tauri';
import type {
  IGitCommitResultPayload,
  IGitFileBaselinePayload,
  IGitRepositoryStatusPayload,
} from '@/types/git';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

const createEmptyGitRepositoryStatus = (): IGitRepositoryStatusPayload => ({
  available: false,
  message: null,
  repositoryRootPath: null,
  repositoryName: null,
  gitDirPath: null,
  headBranchName: null,
  headShortName: null,
  headShortOid: null,
  isDetached: false,
  isClean: true,
  ahead: 0,
  behind: 0,
  stagedCount: 0,
  unstagedCount: 0,
  untrackedCount: 0,
  conflictedCount: 0,
  files: [],
  lastCommit: null,
});

const normalizePath = (value: string | null | undefined): string => {
  if (!value) {
    return '';
  }

  const normalized = value.replace(/\\/g, '/');
  const isWindowsStyle = /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('//');
  return isWindowsStyle ? normalized.toLowerCase() : normalized;
};

const deduplicatePaths = (paths: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const path of paths) {
    const key = normalizePath(path);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(path);
  }

  return result;
};

export const useGitStore = defineStore('git', () => {
  const status = ref<IGitRepositoryStatusPayload>(createEmptyGitRepositoryStatus());
  const isLoading = ref(false);
  const baselineCache = ref<Record<string, IGitFileBaselinePayload>>({});
  const baselineEpoch = ref(0);

  let statusRequestId = 0;
  const pendingBaselineRequests = new Map<string, Promise<IGitFileBaselinePayload>>();

  const hasRepository = computed(() => status.value.available && Boolean(status.value.repositoryRootPath));
  const totalChangeCount = computed(
    () =>
      status.value.stagedCount +
      status.value.unstagedCount +
      status.value.untrackedCount +
      status.value.conflictedCount,
  );

  const clearBaselineCache = (): void => {
    baselineCache.value = {};
    baselineEpoch.value += 1;
  };

  const reset = (): void => {
    statusRequestId += 1;
    isLoading.value = false;
    status.value = createEmptyGitRepositoryStatus();
    clearBaselineCache();
  };

  const applyStatus = (payload: IGitRepositoryStatusPayload): IGitRepositoryStatusPayload => {
    const previousRepositoryRoot = normalizePath(status.value.repositoryRootPath);
    const nextRepositoryRoot = normalizePath(payload.repositoryRootPath);

    status.value = payload;

    if (previousRepositoryRoot !== nextRepositoryRoot || !payload.available) {
      clearBaselineCache();
    }

    return payload;
  };

  const refreshRepositoryStatus = async (
    workspaceRootPath?: string | null,
  ): Promise<IGitRepositoryStatusPayload> => {
    if (!workspaceRootPath) {
      reset();
      return status.value;
    }

    const requestId = statusRequestId + 1;
    statusRequestId = requestId;
    isLoading.value = true;

    try {
      const payload = await tauriService.getGitRepositoryStatus(workspaceRootPath);
      if (requestId !== statusRequestId) {
        return status.value;
      }

      return applyStatus(payload);
    } finally {
      if (requestId === statusRequestId) {
        isLoading.value = false;
      }
    }
  };

  const getFileBaseline = async (path: string): Promise<IGitFileBaselinePayload> => {
    const cacheKey = normalizePath(path);
    const cached = baselineCache.value[cacheKey];
    if (cached) {
      return cached;
    }

    const pending = pendingBaselineRequests.get(cacheKey);
    if (pending) {
      return pending;
    }

    const epochAtRequest = baselineEpoch.value;
    const request = tauriService
      .getGitFileBaseline(path)
      .then((payload) => {
        if (epochAtRequest === baselineEpoch.value) {
          baselineCache.value = {
            ...baselineCache.value,
            [cacheKey]: payload,
          };
        }
        return payload;
      })
      .finally(() => {
        pendingBaselineRequests.delete(cacheKey);
      });

    pendingBaselineRequests.set(cacheKey, request);
    return request;
  };

  const invalidateFileBaseline = (path?: string | null): void => {
    const cacheKey = normalizePath(path);
    if (!cacheKey) {
      return;
    }

    if (!(cacheKey in baselineCache.value)) {
      return;
    }

    const nextCache = { ...baselineCache.value };
    delete nextCache[cacheKey];
    baselineCache.value = nextCache;
    baselineEpoch.value += 1;
  };

  const requireRepositoryRootPath = (): string => {
    const repositoryRootPath = status.value.repositoryRootPath;
    if (!repositoryRootPath) {
      throw new Error('当前工作区未检测到 Git 仓库。');
    }

    return repositoryRootPath;
  };

  const stagePaths = async (paths: string[]): Promise<IGitRepositoryStatusPayload> => {
    const deduplicatedPaths = deduplicatePaths(paths);
    if (deduplicatedPaths.length === 0) {
      return status.value;
    }

    const payload = await tauriService.stageGitPaths({
      repositoryRootPath: requireRepositoryRootPath(),
      paths: deduplicatedPaths,
    });
    return applyStatus(payload);
  };

  const unstagePaths = async (paths: string[]): Promise<IGitRepositoryStatusPayload> => {
    const deduplicatedPaths = deduplicatePaths(paths);
    if (deduplicatedPaths.length === 0) {
      return status.value;
    }

    const payload = await tauriService.unstageGitPaths({
      repositoryRootPath: requireRepositoryRootPath(),
      paths: deduplicatedPaths,
    });
    return applyStatus(payload);
  };

  const stageAllChanges = async (): Promise<IGitRepositoryStatusPayload> => {
    const paths = status.value.files
      .filter((item) => !item.isConflicted && (item.isUntracked || item.worktreeStatus !== null))
      .map((item) => item.path);

    return stagePaths(paths);
  };

  const unstageAllChanges = async (): Promise<IGitRepositoryStatusPayload> => {
    const paths = status.value.files
      .filter((item) => item.indexStatus !== null && !item.isConflicted)
      .map((item) => item.path);

    return unstagePaths(paths);
  };

  const commitIndex = async (message: string): Promise<IGitCommitResultPayload> => {
    const payload = await tauriService.commitGitIndex({
      repositoryRootPath: requireRepositoryRootPath(),
      message,
    });
    applyStatus(payload.status);
    clearBaselineCache();
    return payload;
  };

  return {
    status,
    isLoading,
    hasRepository,
    totalChangeCount,
    baselineEpoch,
    refreshRepositoryStatus,
    getFileBaseline,
    invalidateFileBaseline,
    clearBaselineCache,
    stagePaths,
    unstagePaths,
    stageAllChanges,
    unstageAllChanges,
    commitIndex,
    reset,
  };
});
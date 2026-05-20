const AED_DIFF_REF_PREFIX = 'aed-diff:';

export interface IAiAedDiffRefTarget {
  taskId: string;
  path: string;
}


export const buildAiAedDiffRef = (target: IAiAedDiffRefTarget): string =>
  `${AED_DIFF_REF_PREFIX}${encodeURIComponent(target.taskId)}:${encodeURIComponent(target.path)}`;


export const parseAiAedDiffRef = (diffRef: string): IAiAedDiffRefTarget | null => {
  if (!diffRef.startsWith(AED_DIFF_REF_PREFIX)) {
    return null;
  }
  const payload = diffRef.slice(AED_DIFF_REF_PREFIX.length);
  const separatorIndex = payload.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex >= payload.length - 1) {
    return null;
  }
  try {
    const taskId = decodeURIComponent(payload.slice(0, separatorIndex)).trim();
    const path = decodeURIComponent(payload.slice(separatorIndex + 1)).trim();
    if (!taskId || !path) {
      return null;
    }
    return { taskId, path };
  } catch {
    return null;
  }
};


export const isAiAedDiffRef = (value: string): boolean =>
  value.startsWith(AED_DIFF_REF_PREFIX);
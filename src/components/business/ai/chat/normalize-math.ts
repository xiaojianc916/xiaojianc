const BOX_COMMANDS = ['\\boxed', '\\fbox'] as const;

const readBalancedGroup = (
  source: string,
  openBraceIndex: number,
): { content: string; endIndex: number } | null => {
  if (source[openBraceIndex] !== '{') return null;
  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\\') {
      // 跳过 LaTeX 转义：\{ \} \\ 等
      index += 1;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char !== '}') continue;
    depth -= 1;
    if (depth === 0) {
      return {
        content: source.slice(openBraceIndex + 1, index),
        endIndex: index,
      };
    }
  }
  return null;
};

const unwrapCommandAt = (
  source: string,
  startIndex: number,
  command: string,
): { value: string; endIndex: number } | null => {
  if (!source.startsWith(command, startIndex)) return null;
  const after = startIndex + command.length;
  // 词边界：紧跟字母说明是别的命令名
  const nextCode = source.charCodeAt(after);
  const isLetter = (nextCode >= 65 && nextCode <= 90) || (nextCode >= 97 && nextCode <= 122);
  if (isLetter) return null;

  const group = readBalancedGroup(source, after);
  if (!group) return null;
  return {
    value: normalizeAiMath(group.content),
    endIndex: group.endIndex,
  };
};

/** 移除 AI 输出里用于强调结果的盒子公式命令，避免 KaTeX 渲染出额外边框。 */
export const normalizeAiMath = (source: string): string => {
  let normalized = '';
  for (let index = 0; index < source.length; index += 1) {
    let unwrapped: { value: string; endIndex: number } | null = null;
    for (const command of BOX_COMMANDS) {
      unwrapped = unwrapCommandAt(source, index, command);
      if (unwrapped) break;
    }
    if (unwrapped) {
      normalized += unwrapped.value;
      index = unwrapped.endIndex;
      continue;
    }
    normalized += source[index];
  }
  return normalized;
};

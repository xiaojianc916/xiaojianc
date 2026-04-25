const DISPATCH_RUNNER_ECHO_PATTERN = /\/tmp\/sh-editor-dispatch-[^\s'"]+\.sh/i;

export const stripInternalDispatchEcho = (value: string): string => {
  if (!DISPATCH_RUNNER_ECHO_PATTERN.test(value)) {
    return value;
  }

  const segments = value.split(/(\r?\n)/);
  let result = '';
  for (let index = 0; index < segments.length; index += 2) {
    const line = segments[index] ?? '';
    const lineBreak = segments[index + 1] ?? '';
    if (DISPATCH_RUNNER_ECHO_PATTERN.test(line)) {
      continue;
    }
    result += `${line}${lineBreak}`;
  }

  return result;
};

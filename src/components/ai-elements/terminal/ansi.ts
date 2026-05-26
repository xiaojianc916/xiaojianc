interface IAnsiToken {
  text: string;
  style: string;
}

const ANSI_SEQUENCE_PATTERN = /\x1B\[([0-9;]*)m/gu;
const ANSI_CONTROL_SEQUENCE_PATTERN =
  /\x1B(?:\][^\x07]*(?:\x07|\x1B\\)|\[[0-?]*[ -/]*[@-~]|\][^\n\r]*)/gu;
const ANSI_FG_COLORS: Record<number, string> = {
  30: 'var(--terminal-ansi-black)',
  31: 'var(--terminal-ansi-red)',
  32: 'var(--terminal-ansi-green)',
  33: 'var(--terminal-ansi-yellow)',
  34: 'var(--terminal-ansi-blue)',
  35: 'var(--terminal-ansi-magenta)',
  36: 'var(--terminal-ansi-cyan)',
  37: 'var(--terminal-ansi-white)',
  90: 'var(--terminal-ansi-bright-black)',
};

const createAnsiStyle = (codes: readonly number[]): string => {
  const styles: string[] = [];

  if (codes.includes(1)) {
    styles.push('font-weight: 650');
  }

  for (const code of codes) {
    const color = ANSI_FG_COLORS[code];

    if (color) {
      styles.push(`color: ${color}`);
    }
  }

  return styles.join('; ');
};

export const parseAnsiOutput = (output: string): IAnsiToken[] => {
  const tokens: IAnsiToken[] = [];
  const visibleOutput = output.replace(ANSI_CONTROL_SEQUENCE_PATTERN, '');
  let lastIndex = 0;
  let activeCodes: number[] = [];

  for (const match of visibleOutput.matchAll(ANSI_SEQUENCE_PATTERN)) {
    const matchIndex = match.index ?? 0;

    if (matchIndex > lastIndex) {
      tokens.push({
        text: visibleOutput.slice(lastIndex, matchIndex),
        style: createAnsiStyle(activeCodes),
      });
    }

    const codes = (match[1] || '0')
      .split(';')
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value));

    if (codes.length === 0 || codes.includes(0)) {
      activeCodes = [];
    } else {
      activeCodes = [
        ...activeCodes.filter((code) => code === 1 && !codes.includes(22)),
        ...codes.filter((code) => code !== 22),
      ];
    }

    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < visibleOutput.length) {
    tokens.push({
      text: visibleOutput.slice(lastIndex),
      style: createAnsiStyle(activeCodes),
    });
  }

  return tokens.length ? tokens : [{ text: visibleOutput, style: '' }];
};

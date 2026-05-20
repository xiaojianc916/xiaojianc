export interface ISuggestionLayoutOptions {
  targetWidth: number;
  chipHorizontalPadding?: number;
  chipGap?: number;
  fontAverageWidth?: number;
  minChipWidth?: number;
  maxChipWidth?: number;
}

const DEFAULT_CHIP_HORIZONTAL_PADDING = 34;
const DEFAULT_CHIP_GAP = 12;
const DEFAULT_FONT_AVERAGE_WIDTH = 7.5;
const DEFAULT_MIN_CHIP_WIDTH = 86;
const DEFAULT_MAX_CHIP_WIDTH = 360;
const WIDE_CHAR_PATTERN =
  /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u;
const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;
const COMBINING_MARK_RANGES = [
  [0x0300, 0x036f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe20, 0xfe2f],
] as const;
const VARIATION_SELECTOR_RANGES = [
  [0xfe00, 0xfe0f],
] as const;

const isCodePointInRanges = (
  codePoint: number | undefined,
  ranges: readonly (readonly [number, number])[],
): boolean => {
  if (codePoint === undefined) {
    return false;
  }

  return ranges.some(([start, end]) => codePoint >= start && codePoint <= end);
};

const isCombiningMark = (char: string): boolean =>
  isCodePointInRanges(char.codePointAt(0), COMBINING_MARK_RANGES);

const isVariationSelector = (char: string): boolean =>
  isCodePointInRanges(char.codePointAt(0), VARIATION_SELECTOR_RANGES);

export const getSuggestionVisualLength = (value: string): number => {
  const normalizedValue = value.normalize('NFC');
  let width = 0;

  for (const char of normalizedValue) {
    if (isCombiningMark(char) || isVariationSelector(char)) {
      continue;
    }

    if (WIDE_CHAR_PATTERN.test(char) || EMOJI_PATTERN.test(char)) {
      width += 2;
      continue;
    }

    width += 1;
  }

  return width;
};

export const estimateSuggestionChipWidth = (
  suggestion: string,
  options: Pick<
    ISuggestionLayoutOptions,
    'chipHorizontalPadding' | 'fontAverageWidth' | 'minChipWidth' | 'maxChipWidth'
  > = {},
): number => {
  const chipHorizontalPadding = options.chipHorizontalPadding ?? DEFAULT_CHIP_HORIZONTAL_PADDING;
  const fontAverageWidth = options.fontAverageWidth ?? DEFAULT_FONT_AVERAGE_WIDTH;
  const minChipWidth = options.minChipWidth ?? DEFAULT_MIN_CHIP_WIDTH;
  const maxChipWidth = options.maxChipWidth ?? DEFAULT_MAX_CHIP_WIDTH;
  const estimatedWidth = getSuggestionVisualLength(suggestion) * fontAverageWidth + chipHorizontalPadding;

  return Math.min(maxChipWidth, Math.max(minChipWidth, estimatedWidth));
};

export const groupSuggestionsByEstimatedWidth = (
  suggestions: readonly string[],
  options: ISuggestionLayoutOptions,
): string[][] => {
  const targetWidth = Math.max(options.targetWidth, 1);
  const chipGap = options.chipGap ?? DEFAULT_CHIP_GAP;
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentWidth = 0;

  for (const suggestion of suggestions) {
    const suggestionText = suggestion.trim();

    if (!suggestionText) {
      continue;
    }

    const chipWidth = estimateSuggestionChipWidth(suggestionText, options);
    const nextWidth = currentRow.length > 0
      ? currentWidth + chipGap + chipWidth
      : chipWidth;

    if (currentRow.length > 0 && nextWidth > targetWidth) {
      rows.push(currentRow);
      currentRow = [suggestionText];
      currentWidth = chipWidth;
      continue;
    }

    currentRow = [...currentRow, suggestionText];
    currentWidth = nextWidth;
  }

  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  return rows;
};

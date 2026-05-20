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

/**
 * 命中即视觉宽度按 2 计的码位范围：
 *   - BMP 东亚宽字符 / 全宽符号 / Hangul / CJK Compatibility 等
 *   - SIP 的 CJK Extension B–G（U+20000–U+3FFFD），覆盖生僻字 / 人名用字 / 罕用 emoji
 *   - `\p{Emoji_Presentation}`：默认即按 emoji 渲染的码位
 *
 * 不使用 `\p{Extended_Pictographic}`，避免把 ©®™‼§ 等默认按文本渲染的字符误判为双宽。
 */
const WIDE_OR_EMOJI_PATTERN =
  /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{2fffd}\u{30000}-\u{3fffd}]|\p{Emoji_Presentation}/u;

const COMBINING_MARK_RANGES = [
  [0x0300, 0x036f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe20, 0xfe2f],
] as const;

const VARIATION_SELECTOR_RANGES = [[0xfe00, 0xfe0f]] as const;

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

/**
 * 字素簇切分器（仅初始化一次）。
 * 用 `Intl.Segmenter` 是为了正确处理：
 *   - ZWJ 复合 emoji（👨‍👩‍👧 是一个宽度 2 的视觉单元，不是 5）
 *   - 肤色修饰 / 国旗 / 键帽序列
 *   - 基字符 + 组合标记（自动归并入同一字素）
 *
 * 在不支持 `Intl.Segmenter` 的环境（极少见）下，回退到逐码位迭代。
 */
const graphemeSegmenter: Intl.Segmenter | null =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

function* iterateGraphemes(value: string): Iterable<string> {
  if (graphemeSegmenter) {
    for (const { segment } of graphemeSegmenter.segment(value)) {
      yield segment;
    }
    return;
  }
  // 回退：string 自身是 Iterable<码位>
  for (const char of value) {
    yield char;
  }
}

export const getSuggestionVisualLength = (value: string): number => {
  const normalizedValue = value.normalize('NFC');
  let width = 0;
  for (const grapheme of iterateGraphemes(normalizedValue)) {
    // Segmenter 可用时，组合标记 / VS 已合并入所属字素，此处不会单独出现；
    // 回退路径下逐码位迭代，仍需跳过孤立的组合标记 / VS。
    if (!graphemeSegmenter && (isCombiningMark(grapheme) || isVariationSelector(grapheme))) {
      continue;
    }
    if (WIDE_OR_EMOJI_PATTERN.test(grapheme)) {
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
  const estimatedWidth =
    getSuggestionVisualLength(suggestion) * fontAverageWidth + chipHorizontalPadding;
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

    currentRow.push(suggestionText);
    currentWidth = nextWidth;
  }

  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  return rows;
};
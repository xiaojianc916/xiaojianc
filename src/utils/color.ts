export interface IRgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

// ──────────────────────────────────────────────────────────────────────
// Primitives
// ──────────────────────────────────────────────────────────────────────

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const toByte = (value: number): number => Math.round(clamp(value, 0, 255));

const parseFiniteNumber = (value: string, message: string): number => {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(message);
  }
  return numeric;
};

const normalizeAlpha = (value: string | undefined): number => {
  if (!value) {
    return 255;
  }
  const trimmed = value.trim();
  if (trimmed.endsWith('%')) {
    return toByte((parseFiniteNumber(trimmed, `无法解析颜色透明度：${value}`) / 100) * 255);
  }
  const numeric = parseFiniteNumber(trimmed, `无法解析颜色透明度：${value}`);
  return toByte(numeric <= 1 ? numeric * 255 : numeric);
};

/**
 * 解析支持百分号 / 数字的值。
 * @param percentScale 当值为百分比时，100% 映射到该刻度（如 OKLCH L → 1，OKLCH C → 0.4）。
 */
const parsePercentOrNumber = (value: string, percentScale = 1): number => {
  const trimmed = value.trim();
  if (trimmed.endsWith('%')) {
    return (parseFiniteNumber(trimmed, `无法解析颜色数值：${value}`) / 100) * percentScale;
  }
  return parseFiniteNumber(trimmed, `无法解析颜色数值：${value}`);
};

/**
 * 解析 HSL 的 saturation / lightness。
 * 现代语法允许无单位（`50` ≡ `50%`），都映射到 [0, 1]。
 */
const parseHslPercentOrNumber = (value: string): number => {
  const trimmed = value.trim();
  const stripped = trimmed.endsWith('%') ? trimmed.slice(0, -1) : trimmed;
  return parseFiniteNumber(stripped, `无法解析 HSL 分量：${value}`) / 100;
};

const parseHueDegrees = (value: string): number => {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.endsWith('turn')) {
    return parseFiniteNumber(trimmed, `无法解析色相：${value}`) * 360;
  }
  if (trimmed.endsWith('rad')) {
    return (parseFiniteNumber(trimmed, `无法解析色相：${value}`) * 180) / Math.PI;
  }
  if (trimmed.endsWith('grad')) {
    return parseFiniteNumber(trimmed, `无法解析色相：${value}`) * 0.9;
  }
  return parseFiniteNumber(trimmed.replace(/deg$/, ''), `无法解析色相：${value}`);
};

// ──────────────────────────────────────────────────────────────────────
// Functional-form arg splitter
// ──────────────────────────────────────────────────────────────────────

interface INormalizedFunctionalArgs {
  parts: string[];
  alpha?: string;
}

/**
 * 拆解函数形式颜色的参数。
 *
 * @param options.expectedNonAlphaCount 非 alpha 参数个数：
 *   - rgb / hsl / oklch 等：3（默认）
 *   - color()：4（色彩空间 + 3 个分量）
 *
 * 显式 `/ alpha` 语法优先生效；只有当没有 `/` 且实际参数多于期望个数时，
 * 才把 trailing 视作 legacy 风格的 alpha，避免误把分量当 alpha。
 */
const normalizeFunctionalArgs = (
  value: string,
  options?: { expectedNonAlphaCount?: number },
): INormalizedFunctionalArgs => {
  const [mainPart, slashAlpha] = value.split('/').map((part) => part.trim());
  const parts = (mainPart ?? '')
    .replaceAll(',', ' ')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (slashAlpha) {
    return { parts, alpha: slashAlpha };
  }

  const expected = options?.expectedNonAlphaCount ?? 3;
  if (parts.length > expected) {
    const alpha = parts.pop();
    if (alpha !== undefined) {
      return { parts, alpha };
    }
  }
  return { parts };
};

// ──────────────────────────────────────────────────────────────────────
// HEX
// ──────────────────────────────────────────────────────────────────────

const HEX_BODY_PATTERN = /^[0-9a-f]+$/i;

const parseHexColor = (value: string): IRgbaColor => {
  const hex = value.slice(1);
  if (!HEX_BODY_PATTERN.test(hex)) {
    throw new Error(`无法解析 HEX 颜色：${value}`);
  }
  const expand = (part: string): string => part + part;
  const read = (part: string): number => Number.parseInt(part, 16);

  if (hex.length === 3 || hex.length === 4) {
    return {
      r: read(expand(hex[0] ?? '0')),
      g: read(expand(hex[1] ?? '0')),
      b: read(expand(hex[2] ?? '0')),
      a: hex.length === 4 ? read(expand(hex[3] ?? 'f')) : 255,
    };
  }
  if (hex.length === 6 || hex.length === 8) {
    return {
      r: read(hex.slice(0, 2)),
      g: read(hex.slice(2, 4)),
      b: read(hex.slice(4, 6)),
      a: hex.length === 8 ? read(hex.slice(6, 8)) : 255,
    };
  }
  throw new Error(`无法解析 HEX 颜色：${value}`);
};

// ──────────────────────────────────────────────────────────────────────
// HSL
// ──────────────────────────────────────────────────────────────────────

const hueToRgb = (p: number, q: number, hue: number): number => {
  let nextHue = hue;
  if (nextHue < 0) nextHue += 1;
  if (nextHue > 1) nextHue -= 1;
  if (nextHue < 1 / 6) return p + (q - p) * 6 * nextHue;
  if (nextHue < 1 / 2) return q;
  if (nextHue < 2 / 3) return p + (q - p) * (2 / 3 - nextHue) * 6;
  return p;
};

const parseHslColor = (content: string): IRgbaColor => {
  const { parts, alpha } = normalizeFunctionalArgs(content);
  if (parts.length < 3) {
    throw new Error(`无法解析 HSL 颜色：${content}`);
  }
  const h = (((parseHueDegrees(parts[0] ?? '0') % 360) + 360) % 360) / 360;
  const s = clamp(parseHslPercentOrNumber(parts[1] ?? '0'), 0, 1);
  const l = clamp(parseHslPercentOrNumber(parts[2] ?? '0'), 0, 1);

  if (s === 0) {
    const gray = toByte(l * 255);
    return { r: gray, g: gray, b: gray, a: normalizeAlpha(alpha) };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: toByte(hueToRgb(p, q, h + 1 / 3) * 255),
    g: toByte(hueToRgb(p, q, h) * 255),
    b: toByte(hueToRgb(p, q, h - 1 / 3) * 255),
    a: normalizeAlpha(alpha),
  };
};

// ──────────────────────────────────────────────────────────────────────
// sRGB gamma
// ──────────────────────────────────────────────────────────────────────

const linearToSrgbGamma = (linear: number): number => {
  const clamped = clamp(linear, 0, 1);
  return clamped <= 0.0031308
    ? 12.92 * clamped
    : 1.055 * clamped ** (1 / 2.4) - 0.055;
};

const linearSrgbToByte = (value: number): number => toByte(linearToSrgbGamma(value) * 255);

/** sRGB 反伽马：非线性 0..1 → 线性光 0..1。display-p3 在 `color()` 中复用相同的传输函数。 */
const srgbGammaToLinear = (nonLinear: number): number => {
  const sign = Math.sign(nonLinear);
  const abs = Math.abs(nonLinear);
  const linear = abs <= 0.04045 ? abs / 12.92 : ((abs + 0.055) / 1.055) ** 2.4;
  return sign * linear;
};

// ──────────────────────────────────────────────────────────────────────
// OKLCH
// ──────────────────────────────────────────────────────────────────────

const parseOklchColor = (content: string): IRgbaColor => {
  const { parts, alpha } = normalizeFunctionalArgs(content);
  if (parts.length < 3) {
    throw new Error(`无法解析 OKLCH 颜色：${content}`);
  }
  const l = parsePercentOrNumber(parts[0] ?? '0', 1);
  // CSS Color 4：OKLCH chroma 的 100% 映射到 0.4，不是 1。
  const c = parsePercentOrNumber(parts[1] ?? '0', 0.4);
  const hRadians = (parseHueDegrees(parts[2] ?? '0') * Math.PI) / 180;

  const a = c * Math.cos(hRadians);
  const b = c * Math.sin(hRadians);

  const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = l - 0.0894841775 * a - 1.291485548 * b;

  const lLinear = lPrime ** 3;
  const mLinear = mPrime ** 3;
  const sLinear = sPrime ** 3;

  return {
    r: linearSrgbToByte(4.0767416621 * lLinear - 3.3077115913 * mLinear + 0.2309699292 * sLinear),
    g: linearSrgbToByte(-1.2684380046 * lLinear + 2.6097574011 * mLinear - 0.3413193965 * sLinear),
    b: linearSrgbToByte(-0.0041960863 * lLinear - 0.7034186147 * mLinear + 1.7076147010 * sLinear),
    a: normalizeAlpha(alpha),
  };
};

// ──────────────────────────────────────────────────────────────────────
// rgb()
// ──────────────────────────────────────────────────────────────────────

const parseRgbComponent = (value: string): number => {
  const trimmed = value.trim();
  if (trimmed.endsWith('%')) {
    return toByte((parseFiniteNumber(trimmed, `无法解析 RGB 分量：${value}`) / 100) * 255);
  }
  return toByte(parseFiniteNumber(trimmed, `无法解析 RGB 分量：${value}`));
};

const parseRgbColor = (content: string): IRgbaColor => {
  const { parts, alpha } = normalizeFunctionalArgs(content);
  if (parts.length < 3) {
    throw new Error(`无法解析 RGB 颜色：${content}`);
  }
  return {
    r: parseRgbComponent(parts[0] ?? '0'),
    g: parseRgbComponent(parts[1] ?? '0'),
    b: parseRgbComponent(parts[2] ?? '0'),
    a: normalizeAlpha(alpha),
  };
};

// ──────────────────────────────────────────────────────────────────────
// color()
// ──────────────────────────────────────────────────────────────────────

/**
 * `color()` 各分量在 0..1 范围内为非线性（gamma-encoded）值；亦兼容写成 0..255 的 byte 形态。
 */
const parseColorComponentTo01 = (value: string): number => {
  const numeric = parsePercentOrNumber(value, 1);
  return numeric > 1 ? numeric / 255 : numeric;
};

/** Linear display-p3 (D65) → linear sRGB (D65)。矩阵来源：CSS Color 4 informative。 */
const linearP3ToLinearSrgb = (
  r: number,
  g: number,
  b: number,
): { r: number; g: number; b: number } => ({
  r: 1.2249401763 * r - 0.2249401763 * g + 0 * b,
  g: -0.0420569418 * r + 1.0420569418 * g + 0 * b,
  b: -0.0196376437 * r - 0.0786360801 * g + 1.0982737238 * b,
});

const SUPPORTED_COLOR_SPACES = ['srgb', 'display-p3'] as const;
type TSupportedColorSpace = (typeof SUPPORTED_COLOR_SPACES)[number];

const isSupportedColorSpace = (value: string): value is TSupportedColorSpace =>
  (SUPPORTED_COLOR_SPACES as readonly string[]).includes(value);

const parseColorFunction = (content: string): IRgbaColor => {
  const { parts, alpha } = normalizeFunctionalArgs(content, { expectedNonAlphaCount: 4 });
  const [space, rRaw = '0', gRaw = '0', bRaw = '0'] = parts;
  if (!space || parts.length < 4) {
    throw new Error(`无法解析 color() 颜色：${content}`);
  }
  const normalizedSpace = space.toLowerCase();
  if (!isSupportedColorSpace(normalizedSpace)) {
    throw new Error(`暂不支持的 color() 色彩空间：${space}`);
  }

  const r01 = parseColorComponentTo01(rRaw);
  const g01 = parseColorComponentTo01(gRaw);
  const b01 = parseColorComponentTo01(bRaw);

  if (normalizedSpace === 'srgb') {
    return {
      r: toByte(r01 * 255),
      g: toByte(g01 * 255),
      b: toByte(b01 * 255),
      a: normalizeAlpha(alpha),
    };
  }

  // display-p3: 非线性 P3 → 线性 P3 → 线性 sRGB → 字节
  const linearP3 = {
    r: srgbGammaToLinear(r01),
    g: srgbGammaToLinear(g01),
    b: srgbGammaToLinear(b01),
  };
  const linearSrgb = linearP3ToLinearSrgb(linearP3.r, linearP3.g, linearP3.b);
  return {
    r: linearSrgbToByte(linearSrgb.r),
    g: linearSrgbToByte(linearSrgb.g),
    b: linearSrgbToByte(linearSrgb.b),
    a: normalizeAlpha(alpha),
  };
};

// ──────────────────────────────────────────────────────────────────────
// Public entries
// ──────────────────────────────────────────────────────────────────────

const COLOR_FUNCTION_PATTERN = /^([a-zA-Z][\w-]*)\((.*)\)$/;

export const parseCssColorToRgba = (value: string): IRgbaColor => {
  const color = value.trim();
  if (!color) {
    throw new Error('颜色值为空。');
  }
  if (color.startsWith('#')) {
    return parseHexColor(color);
  }
  const match = COLOR_FUNCTION_PATTERN.exec(color);
  if (!match) {
    throw new Error(`无法解析颜色：${value}`);
  }
  const functionName = (match[1] ?? '').toLowerCase();
  const content = match[2] ?? '';

  switch (functionName) {
    case 'hsl':
    case 'hsla':
      return parseHslColor(content);
    case 'oklch':
      return parseOklchColor(content);
    case 'rgb':
    case 'rgba':
      return parseRgbColor(content);
    case 'color':
      return parseColorFunction(content);
    default:
      throw new Error(`暂不支持的颜色语法：${functionName}`);
  }
};

export const readCssVarAsRgba = (
  name: `--${string}`,
  element: Element = document.documentElement,
): IRgbaColor => {
  const value = getComputedStyle(element).getPropertyValue(name);
  return parseCssColorToRgba(value);
};
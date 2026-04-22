export interface IRgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const toByte = (value: number): number => Math.round(clamp(value, 0, 255));

const normalizeAlpha = (value: string | undefined): number => {
  if (!value) {
    return 255;
  }

  const trimmed = value.trim();
  if (trimmed.endsWith('%')) {
    return toByte((Number.parseFloat(trimmed) / 100) * 255);
  }

  const numeric = Number.parseFloat(trimmed);
  if (!Number.isFinite(numeric)) {
    throw new Error(`无法解析颜色透明度：${value}`);
  }

  return toByte(numeric <= 1 ? numeric * 255 : numeric);
};

const parsePercentOrNumber = (value: string, percentScale = 1): number => {
  const trimmed = value.trim();
  if (trimmed.endsWith('%')) {
    return (Number.parseFloat(trimmed) / 100) * percentScale;
  }

  const numeric = Number.parseFloat(trimmed);
  if (!Number.isFinite(numeric)) {
    throw new Error(`无法解析颜色数值：${value}`);
  }

  return numeric;
};

const parseHueDegrees = (value: string): number => {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.endsWith('turn')) {
    return Number.parseFloat(trimmed) * 360;
  }
  if (trimmed.endsWith('rad')) {
    return (Number.parseFloat(trimmed) * 180) / Math.PI;
  }
  if (trimmed.endsWith('grad')) {
    return Number.parseFloat(trimmed) * 0.9;
  }

  return Number.parseFloat(trimmed.replace(/deg$/, ''));
};

const normalizeFunctionalArgs = (value: string): { parts: string[]; alpha?: string } => {
  const [mainPart, slashAlpha] = value.split('/').map((part) => part.trim());
  const parts = (mainPart ?? '')
    .replaceAll(',', ' ')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (slashAlpha) {
    return { parts, alpha: slashAlpha };
  }

  if (parts.length > 3) {
    const alpha = parts.pop();
    if (alpha !== undefined) {
      return { parts, alpha };
    }
  }

  return { parts };
};

const parseHexColor = (value: string): IRgbaColor => {
  const hex = value.slice(1);
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
  const s = clamp(parsePercentOrNumber(parts[1] ?? '0', 1), 0, 1);
  const l = clamp(parsePercentOrNumber(parts[2] ?? '0', 1), 0, 1);

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

const linearSrgbToByte = (value: number): number => {
  const clamped = clamp(value, 0, 1);
  const gamma =
    clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return toByte(gamma * 255);
};

const parseOklchColor = (content: string): IRgbaColor => {
  const { parts, alpha } = normalizeFunctionalArgs(content);
  if (parts.length < 3) {
    throw new Error(`无法解析 OKLCH 颜色：${content}`);
  }

  const l = parsePercentOrNumber(parts[0] ?? '0', 1);
  const c = parsePercentOrNumber(parts[1] ?? '0', 1);
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
    b: linearSrgbToByte(-0.0041960863 * lLinear - 0.7034186147 * mLinear + 1.707614701 * sLinear),
    a: normalizeAlpha(alpha),
  };
};

const parseRgbComponent = (value: string): number => {
  const trimmed = value.trim();
  if (trimmed.endsWith('%')) {
    return toByte((Number.parseFloat(trimmed) / 100) * 255);
  }

  return toByte(Number.parseFloat(trimmed));
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

const parseColorFunction = (content: string): IRgbaColor => {
  const { parts, alpha } = normalizeFunctionalArgs(content);
  const [space, r = '0', g = '0', b = '0'] = parts;
  if (!space || parts.length < 4) {
    throw new Error(`无法解析 color() 颜色：${content}`);
  }

  if (!['srgb', 'display-p3'].includes(space.toLowerCase())) {
    throw new Error(`暂不支持的 color() 色彩空间：${space}`);
  }

  const componentToByte = (value: string): number => {
    const numeric = parsePercentOrNumber(value, 1);
    return toByte(numeric <= 1 ? numeric * 255 : numeric);
  };

  return {
    r: componentToByte(r),
    g: componentToByte(g),
    b: componentToByte(b),
    a: normalizeAlpha(alpha),
  };
};

export const parseCssColorToRgba = (value: string): IRgbaColor => {
  const color = value.trim();
  if (!color) {
    throw new Error('颜色值为空。');
  }

  if (color.startsWith('#')) {
    return parseHexColor(color);
  }

  const match = /^([a-zA-Z][\w-]*)\((.*)\)$/.exec(color);
  if (!match) {
    throw new Error(`无法解析颜色：${value}`);
  }

  const functionName = (match[1] ?? '').toLowerCase();
  const content = match[2] ?? '';

  if (functionName === 'hsl' || functionName === 'hsla') {
    return parseHslColor(content);
  }
  if (functionName === 'oklch') {
    return parseOklchColor(content);
  }
  if (functionName === 'rgb' || functionName === 'rgba') {
    return parseRgbColor(content);
  }
  if (functionName === 'color') {
    return parseColorFunction(content);
  }

  throw new Error(`暂不支持的颜色语法：${functionName}`);
};

export const readCssVarAsRgba = (
  name: `--${string}`,
  element: Element = document.documentElement,
): IRgbaColor => {
  const value = getComputedStyle(element).getPropertyValue(name);
  return parseCssColorToRgba(value);
};

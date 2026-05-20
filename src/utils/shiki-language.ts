import type { BundledLanguage, SpecialLanguage } from 'shiki';

export type TShikiLanguage = BundledLanguage | SpecialLanguage;

const SHIKI_LANGUAGE_MAP: Readonly<Partial<Record<string, TShikiLanguage>>> = {
  '': 'text',
  text: 'text',
  txt: 'text',
  plain: 'text',
  plaintext: 'text',

  shell: 'shellscript',
  sh: 'shellscript',
  zsh: 'shellscript',
  bash: 'shellscript',

  ps: 'powershell',
  pwsh: 'powershell',
  powershell: 'powershell',

  cmd: 'bat',
  batch: 'bat',
  bat: 'bat',

  c: 'c',
  h: 'c',

  cpp: 'cpp',
  'c++': 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',

  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  javascript: 'javascript',
  jsx: 'jsx',

  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  typescript: 'typescript',
  tsx: 'tsx',

  vue: 'vue',

  py: 'python',
  python: 'python',

  rb: 'ruby',
  ruby: 'ruby',

  rs: 'rust',
  rust: 'rust',

  go: 'go',
  java: 'java',

  yml: 'yaml',
  yaml: 'yaml',

  md: 'markdown',
  markdown: 'markdown',

  jsonc: 'jsonc',
  json: 'json',

  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  sql: 'sql',
  xml: 'xml',

  dockerfile: 'docker',
  docker: 'docker',

  diff: 'diff',
  patch: 'diff',

  // ── 扩展常用语言（按需保留 / 删除）──
  toml: 'toml',
  mermaid: 'mermaid',
  cs: 'csharp',
  csharp: 'csharp',
  kt: 'kotlin',
  kotlin: 'kotlin',
  php: 'php',
  lua: 'lua',
  swift: 'swift',
  graphql: 'graphql',
  gql: 'graphql',
  proto: 'proto',
  protobuf: 'proto',
  dart: 'dart',
  r: 'r',
  scala: 'scala',
  tf: 'terraform',
  terraform: 'terraform',
  ini: 'ini',
};

export const SHIKI_LANGUAGE_LABELS: Partial<Record<TShikiLanguage, string>> = {
  bat: 'Batch',
  shellscript: 'Shell',
  c: 'C',
  cpp: 'C++',
  css: 'CSS',
  diff: 'Diff',
  docker: 'Dockerfile',
  go: 'Go',
  html: 'HTML',
  java: 'Java',
  javascript: 'JavaScript',
  json: 'JSON',
  jsonc: 'JSONC',
  jsx: 'JSX',
  less: 'Less',
  markdown: 'Markdown',
  powershell: 'PowerShell',
  python: 'Python',
  ruby: 'Ruby',
  rust: 'Rust',
  scss: 'SCSS',
  sql: 'SQL',
  text: 'Text',
  tsx: 'TSX',
  typescript: 'TypeScript',
  vue: 'Vue',
  xml: 'XML',
  yaml: 'YAML',

  toml: 'TOML',
  mermaid: 'Mermaid',
  csharp: 'C#',
  kotlin: 'Kotlin',
  php: 'PHP',
  lua: 'Lua',
  swift: 'Swift',
  graphql: 'GraphQL',
  proto: 'Protocol Buffers',
  dart: 'Dart',
  r: 'R',
  scala: 'Scala',
  terraform: 'Terraform',
  ini: 'INI',
};

export const normalizeLanguageTag = (value: string): string => {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }
  const firstToken = raw.split(/\s+/u, 1)[0] ?? '';
  const beforeColon = firstToken.split(':', 1)[0] ?? '';
  return beforeColon.trim().toLowerCase();
};

export const resolveShikiLanguage = (language: string): TShikiLanguage => {
  const normalized = normalizeLanguageTag(language);
  return SHIKI_LANGUAGE_MAP[normalized] ?? 'text';
};
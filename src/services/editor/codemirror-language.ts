import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { vue } from "@codemirror/lang-vue";
import { xml } from "@codemirror/lang-xml";
import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
} from "@codemirror/language";
import {
  c,
  csharp,
  dart,
  kotlin,
  scala,
} from "@codemirror/legacy-modes/mode/clike";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { protobuf } from "@codemirror/legacy-modes/mode/protobuf";
import { r } from "@codemirror/legacy-modes/mode/r";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import type { Extension } from "@codemirror/state";

export type TCodeMirrorLanguageId = string;

export const CODEMIRROR_LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  bash: "Bash",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  dart: "Dart",
  diff: "Diff",
  dockerfile: "Dockerfile",
  go: "Go",
  html: "HTML",
  ini: "INI",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  jsonc: "JSONC",
  jsx: "JSX",
  kotlin: "Kotlin",
  latex: "LaTeX",
  less: "Less",
  lua: "Lua",
  markdown: "Markdown",
  powershell: "PowerShell",
  protobuf: "Protobuf",
  python: "Python",
  r: "R",
  ruby: "Ruby",
  rust: "Rust",
  scala: "Scala",
  scss: "SCSS",
  shell: "Shell",
  sql: "SQL",
  svg: "SVG",
  swift: "Swift",
  text: "Plain Text",
  toml: "TOML",
  tsx: "TSX",
  typescript: "TypeScript",
  vue: "Vue",
  xml: "XML",
  yaml: "YAML",
};

const LANGUAGE_ALIAS: Readonly<Record<string, string>> = {
  bat: "text",
  cmd: "text",
  conf: "ini",
  cs: "csharp",
  docker: "dockerfile",
  h: "c",
  htm: "html",
  js: "javascript",
  json5: "jsonc",
  kt: "kotlin",
  md: "markdown",
  patch: "diff",
  pl: "text",
  plaintext: "text",
  ps: "powershell",
  ps1: "powershell",
  pwsh: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  shellscript: "bash",
  tex: "latex",
  ts: "typescript",
  txt: "text",
  yml: "yaml",
  zsh: "bash",
  "c++": "cpp",
};

const PRESERVED_ALIAS_LANGUAGE_IDS = new Set([
  "jsx",
  "jsonc",
  "less",
  "scss",
  "svg",
]);

const LANGUAGE_ID_BY_DESCRIPTION_NAME: Readonly<Record<string, string>> = {
  "c++": "cpp",
  "c#": "csharp",
  c: "c",
  css: "css",
  dart: "dart",
  diff: "diff",
  dockerfile: "dockerfile",
  go: "go",
  html: "html",
  ini: "ini",
  java: "java",
  javascript: "javascript",
  json: "json",
  kotlin: "kotlin",
  latex: "latex",
  lua: "lua",
  markdown: "markdown",
  powershell: "powershell",
  "protocol buffers": "protobuf",
  python: "python",
  r: "r",
  ruby: "ruby",
  rust: "rust",
  scala: "scala",
  shell: "bash",
  sql: "sql",
  swift: "swift",
  toml: "toml",
  tsx: "tsx",
  typescript: "typescript",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
};

const streamLanguage = (
  parser: Parameters<typeof StreamLanguage.define>[0],
): LanguageSupport => new LanguageSupport(StreamLanguage.define(parser));

const languageDescriptions: readonly LanguageDescription[] = [
  LanguageDescription.of({
    name: "Shell",
    alias: ["shellscript", "bash", "sh", "zsh"],
    extensions: ["bash", "sh", "zsh"],
    support: streamLanguage(shell),
  }),
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["js", "jsx"],
    extensions: ["js", "jsx", "mjs", "cjs"],
    support: javascript({ jsx: true }),
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["ts"],
    extensions: ["ts", "mts", "cts"],
    support: javascript({ typescript: true }),
  }),
  LanguageDescription.of({
    name: "TSX",
    extensions: ["tsx"],
    support: javascript({ jsx: true, typescript: true }),
  }),
  LanguageDescription.of({
    name: "HTML",
    extensions: ["html", "htm"],
    support: html(),
  }),
  LanguageDescription.of({ name: "Vue", extensions: ["vue"], support: vue() }),
  LanguageDescription.of({
    name: "CSS",
    alias: ["scss", "less"],
    extensions: ["css", "scss", "less"],
    support: css(),
  }),
  LanguageDescription.of({
    name: "JSON",
    alias: ["jsonc"],
    extensions: ["json", "jsonc"],
    support: json(),
  }),
  LanguageDescription.of({
    name: "Markdown",
    alias: ["md"],
    extensions: ["md", "markdown"],
    support: markdown(),
  }),
  LanguageDescription.of({
    name: "Dockerfile",
    alias: ["docker"],
    filename: /^Dockerfile$/u,
    support: streamLanguage(dockerFile),
  }),
  LanguageDescription.of({
    name: "Diff",
    alias: ["patch"],
    extensions: ["diff", "patch"],
    support: streamLanguage(diff),
  }),
  LanguageDescription.of({
    name: "C",
    extensions: ["c", "h"],
    support: streamLanguage(c),
  }),
  LanguageDescription.of({
    name: "C++",
    alias: ["cpp"],
    extensions: ["cpp", "cc", "cxx", "hpp"],
    support: cpp(),
  }),
  LanguageDescription.of({
    name: "C#",
    alias: ["csharp", "cs"],
    extensions: ["cs"],
    support: streamLanguage(csharp),
  }),
  LanguageDescription.of({
    name: "Dart",
    extensions: ["dart"],
    support: streamLanguage(dart),
  }),
  LanguageDescription.of({ name: "Go", extensions: ["go"], support: go() }),
  LanguageDescription.of({
    name: "Java",
    extensions: ["java"],
    support: java(),
  }),
  LanguageDescription.of({
    name: "Kotlin",
    alias: ["kt"],
    extensions: ["kt", "kts"],
    support: streamLanguage(kotlin),
  }),
  LanguageDescription.of({
    name: "Lua",
    extensions: ["lua"],
    support: streamLanguage(lua),
  }),
  LanguageDescription.of({
    name: "PowerShell",
    alias: ["ps", "pwsh"],
    extensions: ["ps1"],
    support: streamLanguage(powerShell),
  }),
  LanguageDescription.of({
    name: "Protocol Buffers",
    alias: ["proto", "protobuf"],
    extensions: ["proto"],
    support: streamLanguage(protobuf),
  }),
  LanguageDescription.of({
    name: "Python",
    alias: ["py"],
    extensions: ["py"],
    support: python(),
  }),
  LanguageDescription.of({
    name: "R",
    extensions: ["r"],
    support: streamLanguage(r),
  }),
  LanguageDescription.of({
    name: "Ruby",
    alias: ["rb"],
    extensions: ["rb"],
    support: streamLanguage(ruby),
  }),
  LanguageDescription.of({
    name: "Rust",
    alias: ["rs"],
    extensions: ["rs"],
    support: rust(),
  }),
  LanguageDescription.of({
    name: "Scala",
    extensions: ["scala"],
    support: streamLanguage(scala),
  }),
  LanguageDescription.of({
    name: "SQL",
    extensions: ["sql"],
    support: sql({}),
  }),
  LanguageDescription.of({
    name: "LaTeX",
    alias: ["stex", "tex"],
    extensions: ["tex"],
    support: streamLanguage(stex),
  }),
  LanguageDescription.of({
    name: "Swift",
    extensions: ["swift"],
    support: streamLanguage(swift),
  }),
  LanguageDescription.of({
    name: "TOML",
    extensions: ["toml"],
    support: streamLanguage(toml),
  }),
  LanguageDescription.of({
    name: "INI",
    alias: ["properties"],
    extensions: ["ini", "properties"],
    support: streamLanguage(properties),
  }),
  LanguageDescription.of({
    name: "XML",
    alias: ["svg"],
    extensions: ["xml", "svg"],
    support: xml(),
  }),
  LanguageDescription.of({
    name: "YAML",
    alias: ["yml"],
    extensions: ["yaml", "yml"],
    support: streamLanguage(yaml),
  }),
];

export function normalizeCodeMirrorLanguageTag(raw: string): string {
  const tag = raw.trim().toLowerCase();
  if (!tag) {
    return "text";
  }

  return LANGUAGE_ALIAS[tag] ?? tag;
}

export function resolveCodeMirrorLanguageId(
  language: string,
): TCodeMirrorLanguageId {
  const normalized = normalizeCodeMirrorLanguageTag(language);
  if (normalized === "text") {
    return "text";
  }

  const description = LanguageDescription.matchLanguageName(
    languageDescriptions,
    normalized,
    true,
  );
  if (!description) {
    return "text";
  }
  if (PRESERVED_ALIAS_LANGUAGE_IDS.has(normalized)) {
    return normalized;
  }

  return (
    LANGUAGE_ID_BY_DESCRIPTION_NAME[description.name.toLowerCase()] ??
    normalized
  );
}

export const resolveCodeMirrorLanguageSupport = (
  language: string,
): LanguageSupport | null => {
  const languageId = resolveCodeMirrorLanguageId(language);
  const support = LanguageDescription.matchLanguageName(
    languageDescriptions,
    languageId,
    true,
  )?.support;
  return support instanceof LanguageSupport ? support : null;
};

export const resolveCodeMirrorLanguageExtension = (
  language: string,
): Extension => {
  return resolveCodeMirrorLanguageSupport(language) ?? [];
};

export const isCodeMirrorLanguageSupport = (
  value: Extension,
): value is LanguageSupport => value instanceof LanguageSupport;

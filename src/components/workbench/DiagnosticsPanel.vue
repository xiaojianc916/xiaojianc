<template>
  <section class="flex h-full min-h-0 flex-col bg-[var(--panel-bg)]">
    <div class="border-b border-[var(--shell-divider)] px-4 py-4">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="truncate text-[15px] font-medium text-[var(--text-primary)]">
          ShellCheck 代码检查
        </h2>
        <span
          class="inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium"
          :class="headerBadgeClass('error', errorCount)"
        >
          错误 {{ errorCount }}
        </span>
        <span
          class="inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium"
          :class="headerBadgeClass('warning', warningCount)"
        >
          警告 {{ warningCount }}
        </span>
      </div>
    </div>

    <div class="workbench-scroll-region min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div
        v-if="!analysis.available"
        class="rounded-xl border border-[#ffcc4d]/18 bg-[#221d13] px-4 py-4 text-[var(--text-secondary)]"
      >
        <div class="flex items-center gap-2 text-[13px] font-medium text-[#ffcc4d]">
          <span
            class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#342b17] text-[11px]"
          >
            !
          </span>
          ShellCheck 当前不可用
        </div>
        <p class="mt-3 text-[13px] leading-6 text-[var(--text-secondary)]">
          {{ analysis.message || '暂时无法返回诊断结果，请稍后重试。' }}
        </p>
      </div>

      <div
        v-else-if="issueCards.length === 0"
        class="flex min-h-full items-center justify-center px-6 py-8 text-center"
      >
        <div class="max-w-xs space-y-3">
          <div
            class="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
          >
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              class="h-5 w-5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m3.5 8.2 2.6 2.6 6-6" />
            </svg>
          </div>
          <div class="space-y-1">
            <p class="text-[14px] font-medium text-[var(--text-primary)]">未发现错误或警告</p>
          </div>
        </div>
      </div>

      <div v-else class="space-y-2.5">
        <article
          v-for="item in issueCards"
          :key="item.key"
          class="group cursor-pointer rounded-xl border p-3.5 transition-[border-color,background-color,box-shadow] duration-150"
          :class="issueCardClass()"
          role="button"
          tabindex="0"
          :aria-label="`跳转到第 ${item.line} 行`"
          @click="handleSelect(item)"
          @keydown.enter.prevent="handleSelect(item)"
          @keydown.space.prevent="handleSelect(item)"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2">
              <span
                class="inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px] font-medium tracking-[0.04em]"
                :class="issueBadgeClass(item.level)"
              >
                {{ severityLabel(item.level) }}
              </span>
              <span class="mono-text truncate text-[12px] text-[var(--text-secondary)]">
                {{ item.code }}
              </span>
            </div>
            <span
              class="mono-text shrink-0 text-[12px] text-[var(--text-quaternary)] transition-colors duration-150 group-hover:text-[var(--text-secondary)]"
            >
              第 {{ item.line }} 行
            </span>
          </div>

          <div
            class="mt-2 border border-white/6 bg-black/18 px-2.5 py-1.5"
            :style="snippetBlockStyle(item)"
          >
            <div
              v-if="item.isEmptyLine"
              class="flex h-full items-end overflow-hidden mono-text text-[11px] leading-4 text-[#ff6b6b]"
            >
              ~
            </div>
            <pre
              v-else
              class="mono-text overflow-x-auto whitespace-pre text-[11px] leading-4"
            ><code><span
                v-for="(token, index) in item.tokens"
                :key="`${item.key}-${index}`"
                :class="snippetTokenClass(token.kind)"
              >{{ token.text }}</span></code></pre>
          </div>

          <p class="mt-2 text-left text-[11px] leading-5 text-[var(--text-tertiary)]">
            {{ item.message }}
          </p>
        </article>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type {
  IAnalyzeScriptPayload,
  IScriptDiagnostic,
  TScriptDiagnosticSeverity,
} from '@/types/editor';
import { computed } from 'vue';

type TSnippetTokenKind =
  | 'plain'
  | 'keyword'
  | 'string'
  | 'comment'
  | 'variable'
  | 'operator'
  | 'option'
  | 'command';

interface ISnippetToken {
  text: string;
  kind: TSnippetTokenKind;
}

interface IDiagnosticCard extends IScriptDiagnostic {
  key: string;
  snippet: string;
  tokens: ISnippetToken[];
  isEmptyLine: boolean;
  lineCount: number;
}

const props = defineProps<{
  analysis: IAnalyzeScriptPayload;
  content: string;
  documentName: string;
}>();

const emit = defineEmits<{
  'select-diagnostic': [line: number, column: number];
}>();

const normalizedLines = computed(() =>
  props.content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n'),
);

const SHELL_KEYWORDS = new Set([
  'if',
  'then',
  'elif',
  'else',
  'fi',
  'for',
  'in',
  'do',
  'done',
  'while',
  'until',
  'case',
  'esac',
  'function',
  'select',
]);

const SHELL_COMMANDS = new Set([
  'echo',
  'printf',
  'read',
  'source',
  '.',
  'export',
  'local',
  'unset',
  'return',
  'exit',
  'test',
  'cd',
  'pwd',
  'grep',
  'sed',
  'awk',
  'find',
  'bash',
  'sh',
]);

const resolveSnippet = (item: IScriptDiagnostic): string => {
  const start = Math.max(0, item.line - 1);
  const end = Math.max(start + 1, item.endLine);
  return normalizedLines.value.slice(start, end).join('\n');
};

const tokenizeSnippet = (snippet: string): ISnippetToken[] => {
  const tokens: ISnippetToken[] = [];
  let index = 0;

  const pushToken = (text: string, kind: TSnippetTokenKind): void => {
    if (text.length === 0) {
      return;
    }

    tokens.push({ text, kind });
  };

  while (index < snippet.length) {
    const rest = snippet.slice(index);
    const currentChar = snippet[index];

    if (/\s/.test(currentChar)) {
      const whitespace = rest.match(/^\s+/)?.[0] ?? currentChar;
      pushToken(whitespace, 'plain');
      index += whitespace.length;
      continue;
    }

    if (currentChar === '#' && (index === 0 || /[\s;|&(){}[\]]/.test(snippet[index - 1] ?? ' '))) {
      pushToken(snippet.slice(index), 'comment');
      break;
    }

    if (currentChar === "'" || currentChar === '"' || currentChar === '`') {
      const delimiter = currentChar;
      let cursor = index + 1;

      while (cursor < snippet.length) {
        const activeChar = snippet[cursor];
        if (activeChar === '\\' && delimiter !== "'") {
          cursor += 2;
          continue;
        }

        cursor += 1;
        if (activeChar === delimiter) {
          break;
        }
      }

      pushToken(snippet.slice(index, cursor), 'string');
      index = cursor;
      continue;
    }

    const variableMatch = rest.match(
      /^\$(?:\{[^}]+\}|\([^)]+\)|[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/,
    );
    if (variableMatch) {
      pushToken(variableMatch[0], 'variable');
      index += variableMatch[0].length;
      continue;
    }

    const optionMatch = rest.match(/^--?[A-Za-z0-9][A-Za-z0-9-]*/);
    if (optionMatch) {
      pushToken(optionMatch[0], 'option');
      index += optionMatch[0].length;
      continue;
    }

    const operatorMatch = rest.match(/^(?:\|\||&&|>>|<<|;;|;&|[|=;()[\]{}<>!])/);
    if (operatorMatch) {
      pushToken(operatorMatch[0], 'operator');
      index += operatorMatch[0].length;
      continue;
    }

    const wordMatch = rest.match(/^[A-Za-z_./][A-Za-z0-9_./:-]*/);
    if (wordMatch) {
      const word = wordMatch[0];
      if (SHELL_KEYWORDS.has(word)) {
        pushToken(word, 'keyword');
      } else if (SHELL_COMMANDS.has(word)) {
        pushToken(word, 'command');
      } else {
        pushToken(word, 'plain');
      }
      index += word.length;
      continue;
    }

    pushToken(currentChar, 'plain');
    index += 1;
  }

  return tokens;
};

const issueCards = computed<IDiagnosticCard[]>(() =>
  props.analysis.diagnostics
    .filter((item) => item.level === 'error' || item.level === 'warning')
    .map((item) => ({
      ...item,
      key: `${item.code}-${item.line}-${item.column}-${item.message}`,
      snippet: resolveSnippet(item),
      tokens: tokenizeSnippet(resolveSnippet(item)),
      isEmptyLine: resolveSnippet(item).length === 0,
      lineCount: Math.max(1, resolveSnippet(item).split('\n').length),
    })),
);

const errorCount = computed(() => issueCards.value.filter((item) => item.level === 'error').length);
const warningCount = computed(
  () => issueCards.value.filter((item) => item.level === 'warning').length,
);

const severityLabel = (level: TScriptDiagnosticSeverity): string => {
  switch (level) {
    case 'error':
      return '错误';
    case 'warning':
      return '警告';
    default:
      return '提示';
  }
};

const headerBadgeClass = (tone: 'error' | 'warning', count: number): string => {
  if (count === 0) {
    return 'border-white/8 bg-white/[0.04] text-[var(--text-tertiary)]';
  }

  switch (tone) {
    case 'error':
      return 'border-[#ff6b6b]/18 bg-[#241519] text-[#ff9aa5]';
    case 'warning':
      return 'border-[#ffcc4d]/18 bg-[#2a2417] text-[#ffcc4d]';
    default:
      return 'border-white/8 bg-white/[0.04] text-[var(--text-secondary)]';
  }
};

const issueCardClass = (): string => {
  return 'border-white/8 bg-white/[0.025] hover:border-white/12 hover:bg-white/[0.045]';
};

const issueBadgeClass = (level: TScriptDiagnosticSeverity): string => {
  switch (level) {
    case 'error':
      return 'bg-[#2c1515] text-[#ff8d98]';
    case 'warning':
      return 'bg-[#2c2415] text-[#ffcc4d]';
    default:
      return 'bg-[rgba(51,92,255,0.12)] text-[#c7d2fe]';
  }
};

const snippetTokenClass = (kind: TSnippetTokenKind): string => {
  switch (kind) {
    case 'keyword':
      return 'text-[#c4b5fd]';
    case 'string':
      return 'text-[#f6c177]';
    case 'comment':
      return 'text-[var(--text-quaternary)]';
    case 'variable':
      return 'text-[#7dd3fc]';
    case 'operator':
      return 'text-[#d1d5db]';
    case 'option':
      return 'text-[#93c5fd]';
    case 'command':
      return 'text-[#a5b4fc]';
    default:
      return 'text-[var(--text-secondary)]';
  }
};

const snippetBlockStyle = (item: IDiagnosticCard): { height: string } => ({
  height: `${item.lineCount * 16 + 14}px`,
});

const handleSelect = (item: IDiagnosticCard): void => {
  emit('select-diagnostic', item.line, item.column);
};
</script>

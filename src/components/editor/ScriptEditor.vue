<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
      <div class="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
        <span class="inline-flex h-2.5 w-2.5 rounded-full bg-rose-400/80" />
        <span class="inline-flex h-2.5 w-2.5 rounded-full bg-amber-300/80" />
        <span class="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
      </div>
      <div class="linear-pill mono-text text-[11px]">bash / shell</div>
    </div>
    <div ref="containerRef" class="min-h-0 flex-1" />
  </div>
</template>

<script setup lang="ts">
import type { TThemeMode } from '@/types/app';
import { monaco } from '@/utils/monaco';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

interface IEditorExpose {
  focusEditor: () => void;
  insertSnippet: (snippet: string) => void;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    theme: TThemeMode;
  }>(),
  {
    modelValue: '',
    theme: 'dark',
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const containerRef = ref<HTMLElement | null>(null);
let editorInstance: monaco.editor.IStandaloneCodeEditor | null = null;

const setTheme = (theme: TThemeMode): void => {
  monaco.editor.setTheme(theme === 'dark' ? 'sh-dark' : 'sh-light');
};

const createEditor = (): void => {
  if (!containerRef.value) {
    return;
  }

  setTheme(props.theme);

  editorInstance = monaco.editor.create(containerRef.value, {
    value: props.modelValue,
    language: 'shell',
    automaticLayout: true,
    minimap: { enabled: false },
    lineNumbers: 'on',
    fontSize: 14,
    fontWeight: '400',
    fontFamily: `Berkeley Mono, JetBrains Mono, Consolas, 'Courier New', monospace`,
    padding: {
      top: 20,
      bottom: 20,
    },
    roundedSelection: false,
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    tabSize: 2,
    insertSpaces: true,
    guides: {
      indentation: true,
    },
    renderWhitespace: 'selection',
    autoIndent: 'advanced',
    folding: true,
    foldingStrategy: 'auto',
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    overviewRulerBorder: false,
    glyphMargin: false,
    scrollbar: {
      verticalScrollbarSize: 10,
      horizontalScrollbarSize: 10,
    },
  });

  editorInstance.onDidChangeModelContent(() => {
    if (!editorInstance) {
      return;
    }

    emit('update:modelValue', editorInstance.getValue());
  });
};

watch(
  () => props.modelValue,
  (value) => {
    if (!editorInstance) {
      return;
    }

    if (editorInstance.getValue() !== value) {
      editorInstance.setValue(value);
    }
  },
);

watch(
  () => props.theme,
  (value) => {
    setTheme(value);
  },
);

onMounted(() => {
  createEditor();
});

onBeforeUnmount(() => {
  editorInstance?.dispose();
  editorInstance = null;
});

const focusEditor = (): void => {
  editorInstance?.focus();
};

const insertSnippet = (snippet: string): void => {
  if (!editorInstance) {
    return;
  }

  const selection = editorInstance.getSelection();
  if (!selection) {
    return;
  }

  editorInstance.executeEdits('insert-snippet', [
    {
      range: selection,
      text: snippet,
      forceMoveMarkers: true,
    },
  ]);
  editorInstance.focus();
};

defineExpose<IEditorExpose>({
  focusEditor,
  insertSnippet,
});
</script>

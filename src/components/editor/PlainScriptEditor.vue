<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
      <div class="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
        <span class="inline-flex h-2.5 w-2.5 rounded-full bg-rose-400/80" />
        <span class="inline-flex h-2.5 w-2.5 rounded-full bg-amber-300/80" />
        <span class="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
      </div>
      <div class="flex items-center gap-2">
        <span class="linear-pill mono-text text-[11px]">fallback editor</span>
        <span class="text-xs text-amber-300">Monaco 初始化失败，已切换到基础编辑器</span>
      </div>
    </div>
    <div class="min-h-0 flex-1 px-5 py-5">
      <textarea
        ref="textareaRef"
        class="mono-text h-full w-full resize-none rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-4 text-[14px] leading-6 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-quaternary)]"
        :value="modelValue"
        spellcheck="false"
        placeholder="# 编辑器回退到基础模式，你仍然可以继续编写、保存与运行 shell 脚本。"
        @input="handleInput"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

interface IEditorExpose {
  focusEditor: () => void;
  insertSnippet: (snippet: string) => void;
}

defineProps<{
  modelValue: string;
  theme?: 'dark' | 'light';
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const textareaRef = ref<HTMLTextAreaElement | null>(null);

const handleInput = (event: Event): void => {
  const target = event.target as HTMLTextAreaElement;
  emit('update:modelValue', target.value);
};

const focusEditor = (): void => {
  textareaRef.value?.focus();
};

const insertSnippet = (snippet: string): void => {
  const element = textareaRef.value;
  if (!element) {
    return;
  }

  const start = element.selectionStart ?? element.value.length;
  const end = element.selectionEnd ?? element.value.length;
  const nextValue = `${element.value.slice(0, start)}${snippet}${element.value.slice(end)}`;
  emit('update:modelValue', nextValue);

  requestAnimationFrame(() => {
    element.focus();
    const caret = start + snippet.length;
    element.setSelectionRange(caret, caret);
  });
};

defineExpose<IEditorExpose>({
  focusEditor,
  insertSnippet,
});
</script>

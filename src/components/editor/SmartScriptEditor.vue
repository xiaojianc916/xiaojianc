<template>
  <component
    :is="currentComponent"
    ref="innerEditorRef"
    :model-value="modelValue"
    :theme="theme"
    @update:model-value="$emit('update:modelValue', $event)" />
</template>

<script setup lang="ts">
import PlainScriptEditor from '@/components/editor/PlainScriptEditor.vue';
import type { TThemeMode } from '@/types/app';
import type { Component } from 'vue';
import { computed, markRaw, onMounted, ref, shallowRef } from 'vue';

interface IEditorExpose {
  focusEditor: () => void;
  insertSnippet: (snippet: string) => void;
}

withDefaults(
  defineProps<{
    modelValue: string;
    theme: TThemeMode;
  }>(),
  {
    modelValue: '',
    theme: 'dark',
  },
);

defineEmits<{
  'update:modelValue': [value: string];
}>();

const innerEditorRef = ref<IEditorExpose | null>(null);
const resolvedComponent = shallowRef<Component>(markRaw(PlainScriptEditor));

const currentComponent = computed(() => resolvedComponent.value);

onMounted(async () => {
  try {
    const module = await import('@/components/editor/ScriptEditor.vue');
    resolvedComponent.value = markRaw(module.default);
  } catch (error) {
    console.error('Monaco 编辑器初始化失败，已回退到基础编辑器。', error);
  }
});

const focusEditor = (): void => {
  innerEditorRef.value?.focusEditor();
};

const insertSnippet = (snippet: string): void => {
  innerEditorRef.value?.insertSnippet(snippet);
};

defineExpose<IEditorExpose>({
  focusEditor,
  insertSnippet,
});
</script>

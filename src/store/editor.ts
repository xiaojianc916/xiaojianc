import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type {
  IEditorDocument,
  IExecutionEnvironment,
  IRunLogEntry,
  IRunResult,
  TDocumentEncoding,
  TExecutorKind,
  TLogLevel,
} from '@/types/editor';
import { DEFAULT_SCRIPT } from '@/utils/templates';

const createDocument = (): IEditorDocument => ({
  path: null,
  name: 'untitled.sh',
  content: DEFAULT_SCRIPT,
  encoding: 'utf-8',
  isDirty: false,
  lineCount: DEFAULT_SCRIPT.split('\n').length,
  charCount: DEFAULT_SCRIPT.length,
});

export const useEditorStore = defineStore('editor', () => {
  const document = ref<IEditorDocument>(createDocument());
  const environment = ref<IExecutionEnvironment>({
    recommended: 'auto',
    hasAny: false,
    executors: [],
  });
  const selectedExecutor = ref<TExecutorKind>('auto');
  const terminalOutput = ref<string>('');
  const runLogs = ref<IRunLogEntry[]>([]);
  const lastRunResult = ref<IRunResult | null>(null);
  const isRunning = ref(false);

  const documentTitle = computed(() =>
    document.value.isDirty ? `${document.value.name} · 未保存` : document.value.name,
  );

  const setDocument = (payload: Partial<IEditorDocument>): void => {
    document.value = {
      ...document.value,
      ...payload,
    };
  };

  const resetDocument = (): void => {
    document.value = createDocument();
  };

  const updateContent = (content: string): void => {
    setDocument({
      content,
      isDirty: true,
      lineCount: content.length === 0 ? 1 : content.split('\n').length,
      charCount: content.length,
    });
  };

  const markSaved = (path: string | null, name: string, encoding: TDocumentEncoding): void => {
    setDocument({
      path,
      name,
      encoding,
      isDirty: false,
      lineCount: document.value.content.length === 0 ? 1 : document.value.content.split('\n').length,
      charCount: document.value.content.length,
    });
  };

  const setEnvironment = (payload: IExecutionEnvironment): void => {
    environment.value = payload;
    if (selectedExecutor.value === 'auto') {
      selectedExecutor.value = 'auto';
    }
  };

  const setTerminalOutput = (value: string): void => {
    terminalOutput.value = value;
  };

  const appendLog = (level: TLogLevel, title: string, detail: string): void => {
    runLogs.value.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      level,
      title,
      detail,
      createdAt: new Date().toISOString(),
    });
  };

  const clearLogs = (): void => {
    runLogs.value = [];
    terminalOutput.value = '';
    lastRunResult.value = null;
  };

  return {
    document,
    environment,
    selectedExecutor,
    terminalOutput,
    runLogs,
    lastRunResult,
    isRunning,
    documentTitle,
    setDocument,
    resetDocument,
    updateContent,
    markSaved,
    setEnvironment,
    setTerminalOutput,
    appendLog,
    clearLogs,
  };
});

import { ref } from 'vue';

export interface IRuntimeErrorState {
  title: string;
  message: string;
  detail: string;
}

export const runtimeErrorState = ref<IRuntimeErrorState | null>(null);

const normalizeErrorDetail = (error: unknown): string => {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
};

export const setRuntimeError = (title: string, error: unknown): void => {
  runtimeErrorState.value = {
    title,
    message: error instanceof Error ? error.message : String(error),
    detail: normalizeErrorDetail(error),
  };
};

export const registerRuntimeDiagnostics = (): void => {
  window.addEventListener('error', (event) => {
    setRuntimeError('应用运行时错误', event.error ?? event.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    setRuntimeError('未处理的异步错误', event.reason);
  });
};

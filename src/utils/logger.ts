import { isAppError } from '@/types/app-error';

type TLogLevel = 'warn' | 'info' | 'error';

export interface ILoggerPayload {
  event: string;
  traceId?: string;
  code?: string;
  err?: unknown;
  [key: string]: unknown;
}

const normalizeErrorFields = (error: unknown): { traceId: string; code: string; message: string } => {
  if (isAppError(error)) {
    return {
      traceId: error.traceId,
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      traceId: 'unavailable',
      code: 'unknown',
      message: error.message,
    };
  }

  return {
    traceId: 'unavailable',
    code: 'unknown',
    message: String(error),
  };
};

const emit = (level: TLogLevel, payload: ILoggerPayload): void => {
  const { err, ...rest } = payload;
  const errorFields = err === undefined ? {} : normalizeErrorFields(err);
  const record = {
    timestamp: new Date().toISOString(),
    level,
    ...errorFields,
    ...rest,
  };
  const serialized = JSON.stringify(record);

  if (level === 'error') {
    console.error(serialized);
    return;
  }

  if (level === 'warn') {
    console.warn(serialized);
    return;
  }

  console.info(serialized);
};

export const logger = {
  warn(payload: ILoggerPayload): void {
    emit('warn', payload);
  },
  info(payload: ILoggerPayload): void {
    emit('info', payload);
  },
  error(payload: ILoggerPayload): void {
    emit('error', payload);
  },
};

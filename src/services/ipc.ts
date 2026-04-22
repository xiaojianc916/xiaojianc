import { defineIpc, type IIpcCallOptions, type TIpcAuditLevel } from '@/services/tauri';
import { z } from 'zod';

export interface IIpcOptions<TInSchema extends z.ZodTypeAny> extends IIpcCallOptions {
  timeoutMs?: number;
  guardHint?: string;
  idempotent?: boolean;
  audit?: TIpcAuditLevel;
  mapArgs?: (
    input: z.output<TInSchema>,
    context: { traceId: string },
  ) => Record<string, unknown> | undefined;
}

/**
 * IPC 模块化服务入口。
 *
 * 新增领域服务优先通过本函数复用 `services/tauri.ts` 的契约校验、超时、取消、
 * traceId 与错误归一化能力，避免在模块内重新拼装裸 `invoke`。
 */
export const ipc = async <TInSchema extends z.ZodTypeAny, TOutSchema extends z.ZodTypeAny>(
  command: string,
  input: z.input<TInSchema>,
  inputSchema: TInSchema,
  outputSchema: TOutSchema,
  options: IIpcOptions<TInSchema> = {},
): Promise<z.output<TOutSchema>> => {
  const call = defineIpc({
    name: command,
    guardHint: options.guardHint ?? command,
    inSchema: inputSchema,
    outSchema: outputSchema,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.idempotent === undefined ? {} : { idempotent: options.idempotent }),
    ...(options.audit === undefined ? {} : { audit: options.audit }),
    ...(options.mapArgs === undefined ? {} : { mapArgs: options.mapArgs }),
  });

  return call(input, options.signal === undefined ? {} : { signal: options.signal });
};

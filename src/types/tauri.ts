import type {
  IExecutionEnvironment,
  IRunResult,
  IRunScriptRequest,
  ISaveScriptRequest,
  IScriptFilePayload,
} from './editor';

export interface ITauriService {
  loadScript(path: string): Promise<IScriptFilePayload>;
  saveScript(payload: ISaveScriptRequest): Promise<IScriptFilePayload>;
  detectEnvironment(): Promise<IExecutionEnvironment>;
  runScript(payload: IRunScriptRequest): Promise<IRunResult>;
  chmodScript(path: string, executor: string): Promise<{ success: boolean; message: string }>;
}

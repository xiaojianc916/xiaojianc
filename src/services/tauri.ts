import type {
  IExecutionEnvironment,
  IRunResult,
  IScriptFilePayload,
} from '@/types/editor';
import type { ITauriService } from '@/types/tauri';
import { assertDesktopRuntime } from '@/utils/desktop-runtime';

const fileFilters = [
  {
    name: 'Shell Script',
    extensions: ['sh', 'bash'],
  },
];

export const tauriService: ITauriService & {
  pickOpenPath(): Promise<string | null>;
  pickSavePath(defaultPath: string): Promise<string | null>;
} = {
  async pickOpenPath() {
    await assertDesktopRuntime('打开本地脚本');
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({
      multiple: false,
      directory: false,
      filters: fileFilters,
    });

    return typeof path === 'string' ? path : null;
  },
  async pickSavePath(defaultPath) {
    await assertDesktopRuntime('保存脚本');
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      defaultPath,
      filters: fileFilters,
    });

    return typeof path === 'string' ? path : null;
  },
  async loadScript(path) {
    await assertDesktopRuntime('读取脚本文件');
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<IScriptFilePayload>('load_script', { path });
  },
  async saveScript(payload) {
    await assertDesktopRuntime('写入脚本文件');
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<IScriptFilePayload>('save_script', { payload });
  },
  async detectEnvironment() {
    await assertDesktopRuntime('检测执行环境');
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<IExecutionEnvironment>('detect_execution_environment');
  },
  async runScript(payload) {
    await assertDesktopRuntime('运行脚本');
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<IRunResult>('run_script', { payload });
  },
  async chmodScript(path, executor) {
    await assertDesktopRuntime('执行 chmod +x');
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<{ success: boolean; message: string }>('chmod_script', {
      payload: { path, executor },
    });
  },
};

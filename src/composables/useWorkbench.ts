import { computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useAppStore } from '@/store/app';
import { useEditorStore } from '@/store/editor';
import { tauriService } from '@/services/tauri';
import { desktopRuntimeReady, waitForDesktopRuntime } from '@/utils/desktop-runtime';
import { COMMAND_TEMPLATES, COMMENT_TEMPLATES } from '@/utils/templates';
import type {
  ICommandTemplate,
  IExecutionEnvironment,
  TDocumentEncoding,
  TExecutorKind,
} from '@/types/editor';

const buildLogDetail = (title: string, detail: string): string => `${title}：${detail}`;

const EMPTY_ENVIRONMENT: IExecutionEnvironment = {
  recommended: 'auto',
  hasAny: false,
  executors: [],
};

export const useWorkbench = () => {
  const appStore = useAppStore();
  const editorStore = useEditorStore();

  const canRun = computed(
    () => editorStore.environment.hasAny && editorStore.document.content.trim().length > 0,
  );

  const ensureDiscardConfirmed = async (scene: string): Promise<boolean> => {
    if (!editorStore.document.isDirty) {
      return true;
    }

    try {
      await ElMessageBox.confirm(
        `当前脚本仍有未保存内容，继续${scene}会丢失本次修改。是否继续？`,
        '提示',
        {
          confirmButtonText: '继续',
          cancelButtonText: '取消',
          type: 'warning',
        },
      );
      return true;
    } catch {
      return false;
    }
  };

  const syncDocumentFromPayload = (
    payload: Awaited<ReturnType<typeof tauriService.loadScript>>,
  ): void => {
    editorStore.setDocument({
      path: payload.path,
      name: payload.name,
      content: payload.content,
      encoding: payload.encoding,
      isDirty: false,
      lineCount: payload.lineCount,
      charCount: payload.charCount,
    });
  };

  const initialize = async (): Promise<void> => {
    const runtimeReady = await waitForDesktopRuntime();
    if (!runtimeReady) {
      editorStore.setEnvironment(EMPTY_ENVIRONMENT);
      editorStore.selectedExecutor = 'auto';
      editorStore.appendLog(
        'info',
        '浏览器预览模式',
        '当前界面运行在浏览器预览环境，打开、保存、执行脚本与 chmod +x 仅在 Tauri 桌面端可用。',
      );
      return;
    }

    try {
      const environment = await tauriService.detectEnvironment();
      editorStore.setEnvironment(environment);
      editorStore.selectedExecutor = 'auto';
      editorStore.appendLog(
        environment.hasAny ? 'success' : 'error',
        '执行环境检测',
        environment.hasAny
          ? `已检测到 ${environment.executors.filter((item) => item.available).length} 个可用执行环境。`
          : '当前系统未发现可执行的 bash/sh 环境，请先安装 WSL 或 Git Bash。',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '执行环境检测失败';
      editorStore.appendLog('error', '执行环境检测失败', message);
      ElMessage.error(message);
    }
  };

  const createNewDocument = async (): Promise<void> => {
    const confirmed = await ensureDiscardConfirmed('新建脚本');
    if (!confirmed) {
      return;
    }

    editorStore.resetDocument();
    editorStore.appendLog('info', '新建脚本', '已创建新的 shell 脚本草稿。');
    ElMessage.success('已创建新的脚本草稿');
  };

  const openDocument = async (): Promise<void> => {
    const confirmed = await ensureDiscardConfirmed('打开其他脚本');
    if (!confirmed) {
      return;
    }

    try {
      const path = await tauriService.pickOpenPath();
      if (!path) {
        return;
      }

      const payload = await tauriService.loadScript(path);
      syncDocumentFromPayload(payload);
      editorStore.appendLog('success', '打开脚本', buildLogDetail('已加载文件', payload.path));
      ElMessage.success(`已打开 ${payload.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '打开脚本失败';
      editorStore.appendLog('error', '打开脚本失败', message);
      ElMessage.error(message);
    }
  };

  const saveDocumentAs = async (): Promise<boolean> => {
    try {
      const targetPath = await tauriService.pickSavePath(
        editorStore.document.path ?? editorStore.document.name,
      );
      if (!targetPath) {
        return false;
      }

      const payload = await tauriService.saveScript({
        path: targetPath,
        content: editorStore.document.content,
        encoding: editorStore.document.encoding,
      });

      syncDocumentFromPayload(payload);
      editorStore.appendLog('success', '另存为成功', buildLogDetail('保存路径', payload.path));
      ElMessage.success('脚本已另存为');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '另存为失败';
      editorStore.appendLog('error', '另存为失败', message);
      ElMessage.error(message);
      return false;
    }
  };

  const saveDocument = async (): Promise<boolean> => {
    if (!editorStore.document.path) {
      return saveDocumentAs();
    }

    try {
      const payload = await tauriService.saveScript({
        path: editorStore.document.path,
        content: editorStore.document.content,
        encoding: editorStore.document.encoding,
      });

      syncDocumentFromPayload(payload);
      editorStore.appendLog('success', '保存成功', buildLogDetail('保存路径', payload.path));
      ElMessage.success('脚本已保存');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败';
      editorStore.appendLog('error', '保存失败', message);
      ElMessage.error(message);
      return false;
    }
  };

  const runScript = async (): Promise<void> => {
    if (!canRun.value) {
      ElMessage.warning('请先确认脚本内容不为空且系统已检测到可执行环境');
      return;
    }

    editorStore.isRunning = true;
    editorStore.appendLog('info', '开始执行', '正在调用本地 shell 环境执行当前脚本。');

    try {
      const result = await tauriService.runScript({
        path: editorStore.document.path,
        content: editorStore.document.content,
        encoding: editorStore.document.encoding,
        executor: editorStore.selectedExecutor,
        isDirty: editorStore.document.isDirty,
      });

      editorStore.lastRunResult = result;
      editorStore.setTerminalOutput(result.combinedOutput);
      editorStore.appendLog(
        result.success ? 'success' : 'error',
        result.success ? '执行成功' : '执行失败',
        `执行器 ${result.executorLabel}，退出码 ${result.exitCode ?? '未知'}，耗时 ${result.durationMs}ms。`,
      );

      if (result.usedTempFile) {
        editorStore.appendLog(
          'info',
          '使用临时脚本执行',
          '检测到当前内容未保存，本次运行已使用临时副本，避免覆盖正式脚本文件。',
        );
      }

      if (result.success) {
        ElMessage.success('脚本执行完成');
      } else {
        ElMessage.error('脚本执行失败，请查看终端输出');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '脚本执行失败';
      editorStore.appendLog('error', '脚本执行失败', message);
      editorStore.setTerminalOutput(message);
      ElMessage.error(message);
    } finally {
      editorStore.isRunning = false;
    }
  };

  const chmodScript = async (): Promise<void> => {
    if (!editorStore.document.path) {
      ElMessage.warning('请先保存脚本后再执行 chmod +x');
      return;
    }

    try {
      const response = await tauriService.chmodScript(
        editorStore.document.path,
        editorStore.selectedExecutor,
      );
      editorStore.appendLog(response.success ? 'success' : 'error', 'chmod +x', response.message);
      if (response.success) {
        ElMessage.success(response.message);
      } else {
        ElMessage.error(response.message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'chmod 执行失败';
      editorStore.appendLog('error', 'chmod +x 执行失败', message);
      ElMessage.error(message);
    }
  };

  const updateContent = (value: string): void => {
    editorStore.updateContent(value);
  };

  const updateEncoding = (value: TDocumentEncoding): void => {
    editorStore.document.encoding = value;
    editorStore.document.isDirty = true;
    editorStore.appendLog('info', '切换编码', `当前编码已切换为 ${value.toUpperCase()}。`);
  };

  const updateExecutor = (value: TExecutorKind): void => {
    editorStore.selectedExecutor = value;
    editorStore.appendLog('info', '切换执行器', `当前执行器已切换为 ${value}。`);
  };

  const toggleTheme = (): void => {
    appStore.applyTheme(appStore.theme === 'dark' ? 'light' : 'dark');
  };

  const notifyTemplateInserted = (template: ICommandTemplate): void => {
    editorStore.appendLog('info', '插入模板', `已插入模板：${template.title}`);
    ElMessage.success(`已插入 ${template.title}`);
  };

  return {
    appStore,
    editorStore,
    isDesktopRuntime: desktopRuntimeReady,
    canRun,
    commandTemplates: COMMAND_TEMPLATES,
    commentTemplates: COMMENT_TEMPLATES,
    initialize,
    createNewDocument,
    openDocument,
    saveDocument,
    saveDocumentAs,
    runScript,
    chmodScript,
    updateContent,
    updateEncoding,
    updateExecutor,
    toggleTheme,
    notifyTemplateInserted,
  };
};

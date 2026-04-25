import { buildMonacoThemeForVariant, getThemeManager, onThemeChanged } from '@/themes';
import type { TThemeMode } from '@/types/app';
import 'monaco-editor/esm/nls.messages.zh-cn.js';
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution';
import 'monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard';
import 'monaco-editor/esm/vs/editor/contrib/comment/browser/comment';
import 'monaco-editor/esm/vs/editor/contrib/find/browser/findController';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess';
import 'monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import 'monaco-editor/min/vs/editor/editor.main.css';

type TMonacoEnvironment = {
  getWorker: () => Worker;
};

type TMonacoThemeName = 'sh-dark' | 'sh-light';

const globalScope = self as typeof self & {
  MonacoEnvironment?: TMonacoEnvironment;
  __SH_EDITOR_MONACO_READY__?: boolean;
};

const resolveMonacoThemeName = (theme: TThemeMode): TMonacoThemeName =>
  theme === 'light' ? 'sh-light' : 'sh-dark';

/**
 * 使用主题管理器中的 L2 Roles 为 Monaco 注册（或刷新）all变体的主题定义。
 * 颜色逻辑统一由 src/themes/derive/monaco.ts 维护，此处只调用注册 API。
 */
const registerMonacoThemesFromManager = (): void => {
  const manager = getThemeManager();
  for (const variant of manager.list()) {
    const themeData = buildMonacoThemeForVariant(variant);
    monaco.editor.defineTheme(
      variant.mode === 'dark' ? 'sh-dark' : 'sh-light',
      themeData as monaco.editor.IStandaloneThemeData,
    );
  }
};

if (!globalScope.MonacoEnvironment) {
  globalScope.MonacoEnvironment = {
    getWorker() {
      return new editorWorker();
    },
  };
}

if (!globalScope.__SH_EDITOR_MONACO_READY__) {
  registerMonacoThemesFromManager();
  globalScope.__SH_EDITOR_MONACO_READY__ = true;

  // 订阅主题切换事件，重新注册 Monaco 主题
  onThemeChanged(() => {
    registerMonacoThemesFromManager();
    // 重新应用当前激活的主题名称（Monaco 需要显式 setTheme 才能热更新）
    const mode = getThemeManager().getMode();
    monaco.editor.setTheme(mode === 'dark' ? 'sh-dark' : 'sh-light');
  });
}

const applyMonacoTheme = (theme: TThemeMode): void => {
  monaco.editor.setTheme(resolveMonacoThemeName(theme));
};

export { applyMonacoTheme, monaco };

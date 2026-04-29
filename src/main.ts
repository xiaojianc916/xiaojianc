import '@/assets/fonts/inter/inter.css';
import { listShellCommandLabels } from './services/shell-command-catalog';
import { pinia } from './store';
import { hydrateSessionStorage } from './store/plugins/tauriSessionStorage';
import { initAppTooltipSystem } from './utils/app-tooltip';
import { renderFatalBootstrapError } from './utils/bootstrap-fatal-error';
import {
  forceRevealMainWindowOnBootstrapFailure,
  isWelcomeWindow,
  resolveWindowLabelFromLocation,
} from './utils/bootstrap-window';
import { registerRuntimeDiagnostics, setRuntimeError } from './utils/runtime-diagnostics';

registerRuntimeDiagnostics();

const MESSAGES = {
  vueErrorLabel: 'Vue render failed',
  bootstrapErrorLabel: 'Application bootstrap failed',
} as const;

const bootstrap = async (): Promise<void> => {
  const currentWindowLabel = resolveWindowLabelFromLocation();

  try {
    await import('./styles.css');

    window.__SH_WINDOW_LABEL__ = currentWindowLabel;

    const [{ createApp }, { getThemeManager }, { default: App }, { default: router }] =
      await Promise.all([
        import('vue'),
        import('./themes'),
        import('./App.vue'),
        import('./router'),
      ]);

    getThemeManager().init();

    if (!isWelcomeWindow(currentWindowLabel)) {
      queueMicrotask(() => {
        void listShellCommandLabels();
      });
      await hydrateSessionStorage();
    }

    const app = createApp(App);
    app.use(pinia);
    app.use(router);
    app.config.errorHandler = (error) => {
      setRuntimeError(MESSAGES.vueErrorLabel, error);
    };

    await router.isReady();
    app.mount('#app');

    if (!isWelcomeWindow(currentWindowLabel)) {
      initAppTooltipSystem();
    }
  } catch (error) {
    console.error(MESSAGES.bootstrapErrorLabel, error);
    setRuntimeError(MESSAGES.bootstrapErrorLabel, error);
    await forceRevealMainWindowOnBootstrapFailure(currentWindowLabel);
    renderFatalBootstrapError(error);
  }
};

void bootstrap();

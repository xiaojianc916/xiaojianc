import { registerRuntimeDiagnostics, setRuntimeError } from './utils/runtime-diagnostics';

registerRuntimeDiagnostics();

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const renderFatalBootstrapError = (error: unknown): void => {
  const target = document.querySelector<HTMLDivElement>('#app');
  if (!target) {
    return;
  }

  const message = escapeHtml(error instanceof Error ? error.message : String(error));
  const detail = escapeHtml(error instanceof Error ? error.stack ?? error.message : String(error));

  target.innerHTML = `
    <section style="min-height:100vh;padding:32px;background:#0b0c0e;color:#f7f8f8;font-family:Inter,'Segoe UI',sans-serif;">
      <div style="max-width:1100px;margin:0 auto;border:1px solid rgba(255,255,255,.08);border-radius:20px;background:rgba(21,22,24,.96);overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.36);">
        <header style="padding:24px 28px;border-bottom:1px solid rgba(255,255,255,.08);">
          <p style="margin:0 0 10px;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#fda4af;">Runtime Diagnostics</p>
          <h1 style="margin:0;font-size:28px;font-weight:600;">应用入口加载失败</h1>
          <p style="margin:14px 0 0;font-size:14px;line-height:1.8;color:#d0d6e0;">前端在最早阶段就发生异常，已直接输出原始错误信息，避免继续出现白屏。</p>
        </header>
        <main style="padding:24px 28px 28px;">
          <div style="padding:16px 18px;border:1px solid rgba(255,255,255,.08);border-radius:16px;background:rgba(255,255,255,.03);">
            <div style="font-size:14px;font-weight:600;">错误摘要</div>
            <div style="margin-top:10px;font-size:14px;line-height:1.8;color:#fecaca;word-break:break-word;">${message}</div>
          </div>
          <div style="margin-top:18px;padding:16px 18px;border:1px solid rgba(255,255,255,.08);border-radius:16px;background:#050607;">
            <div style="margin-bottom:10px;font-size:14px;font-weight:600;">详细堆栈</div>
            <pre style="margin:0;max-height:520px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.7;color:#cbd5e1;">${detail}</pre>
          </div>
        </main>
      </div>
    </section>
  `;
};

const renderBootstrapLoading = (): void => {
  const target = document.querySelector<HTMLDivElement>('#app');
  if (!target) {
    return;
  }

  target.innerHTML = `
    <section style="min-height:100vh;padding:32px;background:#0b0c0e;color:#f7f8f8;font-family:Inter,'Segoe UI',sans-serif;">
      <div style="max-width:1100px;margin:0 auto;border:1px solid rgba(255,255,255,.08);border-radius:20px;background:rgba(21,22,24,.96);overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.36);">
        <header style="padding:24px 28px;border-bottom:1px solid rgba(255,255,255,.08);">
          <p style="margin:0 0 10px;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#818cf8;">Bootstrap</p>
          <h1 style="margin:0;font-size:28px;font-weight:600;">正在启动 SH 编辑器</h1>
          <p style="margin:14px 0 0;font-size:14px;line-height:1.8;color:#d0d6e0;">正在加载前端资源和桌面运行时，如果长时间停留在此界面，说明初始化阶段发生了异常。</p>
        </header>
      </div>
    </section>
  `;
};

const bootstrap = async (): Promise<void> => {
  try {
    renderBootstrapLoading();

    const [{ createApp }, { createPinia }, { default: ElementPlus }, { default: App }] =
      await Promise.all([
        import('vue'),
        import('pinia'),
        import('element-plus'),
        import('./App.vue'),
        import('element-plus/dist/index.css'),
        import('./styles.css'),
      ]);

    const app = createApp(App);

    app.use(createPinia());
    app.use(ElementPlus);
    app.config.errorHandler = (error) => {
      setRuntimeError('Vue 组件渲染错误', error);
    };

    app.mount('#app');
  } catch (error) {
    console.error('应用入口加载失败', error);
    setRuntimeError('应用入口加载失败', error);
    renderFatalBootstrapError(error);
  }
};

void bootstrap();

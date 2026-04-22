# ADR-20260422-window-resize-tearing

**状态**: `proposed`

## 背景

桌面 Shell IDE 在拖拽改变主窗口大小时，OS 原生窗口背景与 WebView 内容合成帧可能不同步，Windows WebView2 场景下会表现为边缘底色撕裂或短暂白闪。

## 决策

采用组合治理：

1. Rust 窗口域新增 `set_window_background`，由前端主题 effect 将 `--background` 解析为 RGBA 后同步到原生窗口底色。
2. 主窗口配置使用 `transparent: false`、固定初始 `backgroundColor`，并保持 `visible: false` 的启动收口。
3. resize 期间在 `html.is-resizing` 作用域内临时抑制 transition / animation / blur / shadow。
4. 由 `useWorkbench` façade 挂载主题同步与 resize 状态监听，视图层不直接协调跨域副作用。

## 必要豁免

`src/assets/css/tailwind.css` 中 `html.is-resizing` 抑制规则使用 `!important`，覆盖 R-5.9 的 MUST NOT。

理由：resize 是系统级短时状态，需要高于组件局部动画的优先级，否则无法稳定抑制合成管线不同帧造成的视觉撕裂。

边界：

- 仅允许命中 `html.is-resizing` 作用域。
- MUST NOT 扩展到普通组件选择器。
- MUST NOT 借此新增全局通用 `!important`。

## 备选方案

1. 仅 CSS 抑制：不能消除原生窗口首帧底色差异，驳回。
2. 切换无边框自绘标题栏：工程代价与交互影响超出本 ADR，另行立项。
3. 只改 `tauri.conf.json`：不能跟随运行时主题切换，驳回。

## 影响面

- `src-tauri/src/commands/window.rs`
- `src-tauri/src/error.rs`
- `src-tauri/tauri.conf.json`
- `src/services/ipc.ts`
- `src/services/modules/window.ts`
- `src/composables/useTheme.ts`
- `src/composables/useWindowResizeState.ts`
- `src/assets/css/shadcn-theme.css`
- `src/assets/css/tailwind.css`

## 回滚方案

1. 停止在 `useWorkbench` 中挂载 `useTheme` / `useWindowResizeState`。
2. 移除 `set_window_background` invoke 入口。
3. 保留 `transparent: false` 与 `backgroundColor` 可作为安全默认；若需回滚透明窗口，必须另走 ADR。

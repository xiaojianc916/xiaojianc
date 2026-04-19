AGENTS.md 
基于 Vite 8 + TypeScript 6 + Tailwind CSS 4.2.2 + ESLint 10 生态对齐，强化工程约束、类型安全、架构规范、Tauri 安全边界，统一团队开发标准，补充完善Shadcn Vue全局主题配置规范，解决原生主题管控短板，确保UI风格统一、符合项目工程化要求。
考虑中文环境，纯UTF-8编码，不要BOM
项目技术栈
- 桌面框架：Tauri
- 前端框架：Vue 3（Composition API + <script setup>）
- 语言：TypeScript 6.0.2
- 构建工具：Vite 8.0.8
- UI 样式：Tailwind CSS 4.2.2
- 组件库：Shadcn Vue（含全局主题集中配置）
- 状态管理：Pinia
- 路由：Vue Router 5.0.4
- 代码规范：

  - ESLint 10.2.0
  - @eslint/js 10.0.1
  - eslint-plugin-vue 10.8.0
  - vue-eslint-parser 10.4.0
- 类型系统：vue-tsc 3.2.6
- 类型定义：@types/node 25.6.0
- Vue TS 配置：@vue/tsconfig0.9.1
- 工具库：monaco-editor 0.55.1
- 全局变量：globals 17.5.0
1. 架构设计原则
1.1 分层架构
- 前端 UI 层（Vue + Shadcn Vue）
        
  - 页面渲染 / 交互 / 状态展示
  - UI 样式统一遵循全局主题配置，禁止组件内单独定义主题变量
- 业务逻辑层（TS + composables）
        
  - 业务处理 / 数据转换 / API 封装
  - 主题相关逻辑（如深色/浅色切换）抽离至 composables 统一管理
- 系统层（Tauri Rust）
        
  - 文件系统 / 系统调用 / 权限控制
1.2 模块化原则
- 功能必须模块化、单一职责
- 禁止跨模块直接访问内部状态
- 统一通过：
        
  - composables
  - store
  - services
推荐结构
src/
├── assets/
│   └── css/
│       └── shadcn-theme.css  # Shadcn Vue 全局主题唯一配置文件
├── components/
│   └── ui/            # Shadcn 基础组件统一存放目录（禁止修改组件内主题样式）
├── views/
├── layouts/
├── composables/
│   └── useTheme.ts    # 主题相关逻辑（切换、获取等）抽离
├── services/
├── store/
├── router/
├── types/
│   └── shadcn-theme.ts # 主题变量类型定义
├── constants/
├── hooks/
└── utils/

2. Vue 3 规范
2.1 组件规范
- 必须 <script setup lang="ts">
- 文件命名：PascalCase
- 禁止模板写复杂逻辑
- UI 与逻辑分离
- 禁止在组件内单独定义 Shadcn Vue 主题相关 CSS 变量，统一引用全局主题配置
2.2 composables 规范
- 所有复杂逻辑必须抽离
- 禁止组件内重复逻辑
- defineProps / defineEmits 必须统一使用
- 主题相关逻辑（如深色/浅色模式切换、主题变量获取）必须抽离至 composables（如 useTheme.ts）
3. TypeScript 规范
- 禁止 any（仅允许极端场景 + 注释说明）
- 所有 API / props / emit 必须类型化
- 类型集中管理 `/types`
- Shadcn Vue 主题变量必须添加 TypeScript 类型定义（路径：src/types/shadcn-theme.ts）
命名：
- interface：IUser / ILoginParams
- type：TResponse / TOption
- enum：EUserRole / EStatus
- 主题相关类型：IShadcnTheme（接口）、TThemeMode（类型别名，如 'light' | 'dark'）
4. Vite 规范
- alias：`@ -> /src`
- env 前缀：`VITE_`
禁止：
- 硬编码 API / key / port
- 直接读取 `.env` 文件
5. Tailwind CSS 4.2.2 规范
- 优先 utility-first
- 禁止滥写自定义 CSS
- 自定义样式统一 `assets/css + @layer`
- Shadcn Vue 主题配置统一管控 UI 风格，主题变量与 Tailwind 变量互通
- 禁止全局覆盖 Tailwind base（主题相关样式统一在 shadcn-theme.css 中通过 @layer base 定义）
6. Shadcn Vue 规范（补充主题配置规范）
6.1 统一基础组件
- 按钮：`Button`
- 表单：`Form` / `FormItem` / `FormField`
- 输入控件：`Input` / `Select` / `Checkbox` / `Radio`
- 表格：`Table` 系列原生组件
- 弹窗抽屉：`Dialog` / `Drawer`
6.2 核心规则
- 所有基础 UI 组件统一使用 Shadcn Vue
- 禁止混用多套 UI 组件库
- 消息提示、通知统一封装全局工具方法
- 表单校验逻辑统一抽离至 composables 集中管理
- 自定义业务组件基于 `components/ui` 内 Shadcn 基础组件二次封装
- 禁止修改 Shadcn 基础组件源码，禁止在组件内单独定义主题 CSS 变量
6.3 全局主题配置规范（核心补充）
6.3.1 配置文件要求
- 唯一配置文件：src/assets/css/shadcn-theme.css（禁止新增其他主题配置文件）
- 文件格式：必须使用 @layer base 包裹，不污染全局样式，统一管理所有主题变量
- 变量规范：涵盖主色、辅助色、中性色、圆角、阴影、间距等，支持浅色/深色模式切换
6.3.2 配置文件示例(只是示例！)
/* Shadcn Vue 全局主题配置（唯一修改入口）
 * 遵循项目 assets/css + @layer 规范，与 Tailwind CSS 4.2.2 互通
 * 所有 Shadcn 组件主题相关样式，均从此处统一管控，禁止组件内单独定义
 */
@layer base {
  /* 全局基础主题变量（浅色模式） */
  :root {
    /* 主色体系（对接 Tailwind 主色，统一视觉风格） */
    --primary: 221.2 83.2% 53.2%;
    --primary-foreground: 0 0% 100%;
    --primary-muted: 221.2 83.2% 90%;
    --primary-muted-foreground: 221.2 83.2% 30%;

    /* 辅助色体系（按项目需求调整，统一使用） */
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --success: 142.1 76.2% 36.3%;
    --success-foreground: 210 40% 98%;

    /* 中性色体系（统一页面背景、文本颜色） */
    --background: 0 0% 100%;
    --foreground: 222.2 47.4% 11.2%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 221.2 83.2% 53.2%;

    /* 全局通用样式（统一所有组件圆角、阴影、间距） */
    --radius: 0.5rem; /* 全局圆角，所有组件统一使用 */
    --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
    --shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px 0 rgb(0 0 0 / 0.06);
    --spacing-xs: 0.25rem;
    --spacing-sm: 0.5rem;
    --spacing-md: 1rem;
  }

  /* 深色模式（全局统一切换，无需组件内单独配置） */
  .dark {
    --primary: 217.2 91.2% 59.8%;
    --primary-foreground: 0 0% 100%;
    --primary-muted: 217.2 91.2% 15%;
    --primary-muted-foreground: 217.2 91.2% 80%;

    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;

    --background: 224 71% 4%;
    --foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 212.7 26.8% 83.9%;
  }
}

6.3.3 与 Tailwind CSS 4.2.2 互通配置（只是示例！）
修改 tailwind.config.ts，实现 Shadcn 主题变量与 Tailwind 变量互通，确保 UI 风格统一：
import type { Config } from 'tailwindcss';

export default {
  theme: {
    extend: {
      colors: {
        // 直接使用 Shadcn 全局主题变量，实现两者统一
        primary: 'hsl(var(--primary))',
        secondary: 'hsl(var(--secondary))',
        destructive: 'hsl(var(--destructive))',
        success: 'hsl(var(--success))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
      },
      borderRadius: {
        // 统一使用 Shadcn 全局圆角变量
        DEFAULT: 'var(--radius)',
      },
      boxShadow: {
        // 统一使用 Shadcn 全局阴影变量
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow)',
      },
      spacing: {
        // 统一使用 Shadcn 全局间距变量
        'xs': 'var(--spacing-xs)',
        'sm': 'var(--spacing-sm)',
        'md': 'var(--spacing-md)',
      },
    },
  },
} satisfies Config;

6.3.4 主题类型定义（符合 TS 强规范）（只是示例！）
路径：src/types/shadcn-theme.ts，添加主题变量类型定义，禁止 any，提供智能提示：
/**
 * Shadcn Vue 全局主题类型定义
 * 与 shadcn-theme.css 中变量一一对应，修改样式需同步修改此处类型
 * 遵循项目 TS 强类型规范，禁止 any
 */
export interface IShadcnTheme {
  primary: string;
  'primary-foreground': string;
  'primary-muted': string;
  'primary-muted-foreground': string;
  secondary: string;
  'secondary-foreground': string;
  destructive: string;
  'destructive-foreground': string;
  success: string;
  'success-foreground': string;
  background: string;
  foreground: string;
  border: string;
  input: string;
  ring: string;
  radius: string;
  'shadow-sm': string;
  shadow: string;
  'spacing-xs': string;
  'spacing-sm': string;
  'spacing-md': string;
}

// 主题模式类型（浅色/深色）
export type TThemeMode = 'light' | 'dark';

// 主题相关方法类型定义
export interface IThemeMethods {
  // 切换主题模式
  toggleTheme: () => void;
  // 获取当前主题模式
  getCurrentTheme: () => TThemeMode;
  // 获取当前主题变量
  getThemeVars: () => IShadcnTheme;
}

6.3.5 主题逻辑抽离（符合 composables 规范）（只是示例！）
路径：src/composables/useTheme.ts，将主题相关逻辑抽离，禁止组件内重复编写：
import { ref, computed } from 'vue';
import type { TThemeMode, IThemeMethods } from '@/types/shadcn-theme';

/**
 * 主题管理 composables
 * 统一处理主题切换、主题变量获取等逻辑
 * 遵循 composables 规范，禁止组件内重复编写主题相关逻辑
 */
export function useTheme(): IThemeMethods {
  // 当前主题模式（默认浅色）
  const themeMode = ref<TThemeMode>('light');

  // 初始化主题（读取本地存储，优先用户之前设置的模式）
  const initTheme = () => {
    const savedTheme = localStorage.getItem('themeMode') as TThemeMode;
    if (savedTheme) {
      themeMode.value = savedTheme;
      document.documentElement.classList.toggle('dark', savedTheme === 'dark');
    }
  };

  // 切换主题模式
  const toggleTheme = () => {
    themeMode.value = themeMode.value === 'light' ? 'dark' : 'light';
    document.documentElement.classList.toggle('dark', themeMode.value === 'dark');
    localStorage.setItem('themeMode', themeMode.value);
  };

  // 获取当前主题模式
  const getCurrentTheme = computed(() => themeMode.value);

  // 获取当前主题变量（从根元素获取，确保与全局配置一致）
  const getThemeVars = (): IShadcnTheme => {
    const root = document.documentElement;
    return {
      primary: getComputedStyle(root).getPropertyValue('--primary').trim(),
      'primary-foreground': getComputedStyle(root).getPropertyValue('--primary-foreground').trim(),
      'primary-muted': getComputedStyle(root).getPropertyValue('--primary-muted').trim(),
      'primary-muted-foreground': getComputedStyle(root).getPropertyValue('--primary-muted-foreground').trim(),
      secondary: getComputedStyle(root).getPropertyValue('--secondary').trim(),
      'secondary-foreground': getComputedStyle(root).getPropertyValue('--secondary-foreground').trim(),
      destructive: getComputedStyle(root).getPropertyValue('--destructive').trim(),
      'destructive-foreground': getComputedStyle(root).getPropertyValue('--destructive-foreground').trim(),
      success: getComputedStyle(root).getPropertyValue('--success').trim(),
      'success-foreground': getComputedStyle(root).getPropertyValue('--success-foreground').trim(),
      background: getComputedStyle(root).getPropertyValue('--background').trim(),
      foreground: getComputedStyle(root).getPropertyValue('--foreground').trim(),
      border: getComputedStyle(root).getPropertyValue('--border').trim(),
      input: getComputedStyle(root).getPropertyValue('--input').trim(),
      ring: getComputedStyle(root).getPropertyValue('--ring').trim(),
      radius: getComputedStyle(root).getPropertyValue('--radius').trim(),
      'shadow-sm': getComputedStyle(root).getPropertyValue('--shadow-sm').trim(),
      shadow: getComputedStyle(root).getPropertyValue('--shadow').trim(),
      'spacing-xs': getComputedStyle(root).getPropertyValue('--spacing-xs').trim(),
      'spacing-sm': getComputedStyle(root).getPropertyValue('--spacing-sm').trim(),
      'spacing-md': getComputedStyle(root).getPropertyValue('--spacing-md').trim(),
    };
  };

  // 初始化主题
  initTheme();

  return {
    toggleTheme,
    getCurrentTheme: () => getCurrentTheme.value,
    getThemeVars,
  };
}

6.3.6 禁止项（红线规则补充）
- 禁止修改 Shadcn 基础组件源码中的主题相关样式
- 禁止在任何组件内单独定义主题 CSS 变量（如 --primary、--radius 等）
- 禁止使用 !important 或深层选择器覆盖 Shadcn 组件样式（如需调整，修改全局主题配置）
- 禁止新增多个主题配置文件，必须统一在 shadcn-theme.css 中修改
- 禁止主题变量与 Tailwind 变量不一致，必须保持互通同步
7. Tauri 规范（强化安全）（只是示例！）
7.1 前端调用
import { invoke } from '@tauri-apps/api'

const getLocalFile = async () => {
  try {
    return await invoke('get_local_file', { path: 'xxx' })
  } catch (e) {
    throw new Error(`Tauri调用失败：${e}`)
  }
}

7.2 Rust 规范
- 必须 Result 返回
- 禁止 panic
- snake_case 命名
- 最小权限原则
8. Pinia 规范
- useXXXStore
- setup store
- 禁止 store 互相调用
- 状态分类：
        
  - persistent（加密）
  - temporary
- 主题相关状态（如当前主题模式）可存入 Pinia（persistent 加密存储），禁止直接存在 localStorage 以外的地方
9. services 规范
- 所有请求 / IPC 统一封装
- 禁止组件内 try/catch
- 统一错误处理 request.ts
结构：
services/
├── user.ts
├── file.ts
├── system.ts
└── request.ts

10. 性能优化
- 路由懒加载（必做）
- 组件动态 import
- 长列表虚拟滚动
- 避免 unnecessary reactive
- 图片 webp + 压缩
- 大组件 Suspense
- 主题切换时避免页面重绘，可通过 CSS 过渡优化体验
11. 安全规范
- Tauri 权限最小化
- 禁止暴露系统路径
- 所有输入必须校验
- 禁止未授权 IPC 调用
- token 必须加密存储
- API 必须鉴权
- 主题配置文件禁止包含敏感信息，禁止硬编码密钥、路径等
12. Git 规范
提交格式：
- feat: xxx（新增功能，如新增主题切换功能）
- fix: xxx（修复问题，如修复主题切换异常）
- refactor: xxx（重构代码，不改变功能）
- perf: xxx（性能优化）
- chore: xxx（构建、依赖等调整，如更新主题配置）
13. 开发流程（强约束）
1. types（定义主题相关类型）
2. constants（常量定义）
3. composables（抽离主题逻辑）
4. services（接口封装）
5. UI（使用 Shadcn 组件，引用全局主题）
6. store（主题状态管理）
7. test（测试）
14. 命名规范
- 文件：kebab-case（如 shadcn-theme.css、use-theme.ts）
- 组件：PascalCase
- 方法：camelCase（如 toggleTheme、getThemeVars）
- 常量：UPPER_SNAKE_CASE
- IPC：snake_case
- 主题相关类型：IShadcnTheme（接口）、TThemeMode（类型别名）
- 主题相关 composables：useTheme.ts（遵循 useXXX 命名规范）
15. ESLint + Prettier
- ESLint 10 强制启用 flat config（推荐）
- Prettier 自动格式化
- LF + single quote + 2 spaces
- commit 前必须 lint + typecheck
- 主题配置文件（shadcn-theme.css）、类型文件、composables 文件必须通过 ESLint 校验
16. Husky 校验
提交前必须通过：
- eslint
- prettier
- tsc
- vite build
17. 红线规则
- 禁止 any
- 禁止 DOM 操作
- 禁止业务写在组件
- 禁止跨模块耦合
- 禁止未处理异常
- 禁止 UI 混库
- 禁止未测试提交
- 禁止修改 Shadcn 组件源码内主题样式
- 禁止在组件内单独定义主题变量
- 禁止主题配置与 Tailwind 配置不一致
18. 扩展方向（升级适配）
- 多窗口（Tauri）
- 插件系统
- 自动更新
- i18n 国际化
- 日志系统（前后端统一）
- IPC 类型安全化
- store 加密持久化
- 主题扩展：支持多套主题切换（如系统主题、自定义主题）
- 主题配置可视化：开发主题配置面板，支持实时预览修改
19. 补充优化
- 推荐启用：
        
  - unplugin-auto-import（自动导入 composables、Vue API）
  - unplugin-vue-components（自动导入 Shadcn 组件）
- Vite 8 建议开启：
        
  - build cache（构建缓存，提升构建速度）
  - deps optimization（依赖优化）
- Shadcn Vue 主题优化：
        
  - 定期同步 Shadcn Vue 组件更新，确保主题配置兼容
  - 主题变量按模块分类，提升可维护性
  - 添加主题配置注释，方便团队理解和修改
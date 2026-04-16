AGENTS.mdAGENTS.md
项目技术栈
本项目采用以下技术路线：
桌面框架：Tauri
前端框架：Vue 3（Composition API + <script setup>）
语言：TypeScript
构建工具：Vite
UI 样式：Tailwind CSS
组件库：Element Plus
状态管理：Pinia
代码规范：ESLint + Prettier
---
1. 架构设计原则
1.1 分层架构
项目分为三层：
前端 UI 层（Vue）
界面渲染、用户交互、状态展示
业务逻辑层（TS + Vue Composables）
业务处理、API 封装、逻辑复用
系统层（Tauri Rust）
文件系统、本地资源、系统调用
1.2 模块化原则
功能模块化
单一职责
禁止跨模块直接访问内部状态
推荐目录结构：
```markdown
src/
 ├── assets/         静态资源
 ├── components/     通用组件
 ├── views/          页面
 ├── layouts/        布局
 ├── composables/    业务逻辑复用
 ├── services/       API / Tauri 调用
 ├── store/          Pinia 状态
 ├── router/         路由
 ├── types/          TS 类型定义
 └── utils/          工具函数
```
---
2. Vue 3 开发规范
2.1 组件规范
必须使用 <script setup lang="ts">
文件命名：PascalCase
禁止模板复杂逻辑
2.2 组合式 API 规范
复杂逻辑必须抽离到 composables
组件只做视图，不写业务逻辑
---
3. TypeScript 规范
3.1 强类型
禁止使用 any
必须定义接口/类型
类型统一放在 `/types` 目录
3.2 命名规范
接口：IXXX
类型：TXXX
---
4. Vite 规范
4.1 别名
`@` → `/src`
4.2 环境变量
使用 `.env` 管理，禁止硬编码地址
---
5. Tailwind CSS 规范
优先使用原生类
避免自定义 CSS
类名按功能分组
---
6. Element Plus 规范
用于表格、表单、弹窗等复杂组件
样式覆盖使用 `:deep()` 或 CSS 变量
---
7. Tauri 集成规范
7.1 前端调用
```typescript
import { invoke } from '@tauri-apps/api'
await invoke('command_name')
```
7.2 Rust 命令规范
```rust
#[tauri::command]
fn command_name() -> Result<String, String> {
    Ok("content".into())
}
```
---
8. Pinia 状态管理规范
按业务模块化
命名：useXXXStore
统一使用 setup 语法
---
9. API / Tauri 服务规范
9.1 统一封装
所有请求放在 services/
统一错误处理
禁止在组件内写 try/catch
9.2 错误反馈
成功：ElMessage.success
失败：ElMessage.error
9.3 API 服务结构
```markdown
services/
 ├── user.ts      用户相关
 ├── file.ts      文件操作
 └── request.ts   基础封装
```
---
10. 性能优化
路由懒加载
组件按需加载
避免不必要响应式
---
11. 安全规范
Tauri 权限最小化
所有输入必须校验
禁止暴露本地路径
禁止执行未校验命令
---
12. Git 提交规范
```markdown
feat:     新功能
fix:      修复
refactor: 重构
style:    样式/格式
docs:     文档
chore:    构建/依赖
```
---
13. 开发流程（必须遵守）
定义类型（types）
编写业务逻辑（composables）
编写 UI 组件
接入 services / Tauri
测试与异常处理
---
14. 命名统一规范
文件/文件夹：kebab-case
组件/类：PascalCase
变量/方法：camelCase
常量：UPPER_SNAKE_CASE
Tauri 命令：snake_case
---
15. 代码格式化规范
ESLint + Prettier 强制开启
保存自动格式化
禁止提交未格式化代码
---
16. 提交前校验（Husky）
代码检查
格式化检查
构建检查
不通过禁止提交
---
17. 禁止事项（红线）
禁止 any
禁止直接操作 DOM
禁止在组件写业务逻辑
禁止模块耦合
禁止硬编码敏感信息
禁止跳过错误处理
---
18. 未来扩展
多窗口支持
插件系统
自动更新
主题切换
国际化

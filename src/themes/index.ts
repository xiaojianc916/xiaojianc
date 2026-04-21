/**
 * themes/index.ts — 主题系统对外入口
 *
 * 消费者只应通过此文件 import；禁止直接 import 内部子模块。
 *
 * 公开 API：
 *  - getThemeManager()              取得单例管理器
 *  - onThemeChanged()               订阅主题切换事件（非 CSS 消费者使用）
 *  - buildMonacoThemeForVariant()   Monaco 主题构造（含 L3 派生，对 L4 透明）
 *  - buildTerminalTheme()           终端主题构造函数（由 useIntegratedTerminal 消费）
 *  - type IRoles                    供高级自定义插槽引用
 *  - type TVariantId                变体 ID 字面量
 *  - type IThemeChangedDetail       事件 payload
 */

import { buildComponentTokens } from './components';
import { buildMonacoTheme } from './derive/monaco';
import type { IThemeVariant } from './types';

export { buildTerminalTheme } from './derive/terminal';
export type { IXtermTheme } from './derive/terminal';
export { createThemeManager, getThemeManager, onThemeChanged } from './manager';
export type { IComponentTokens, IThemeChangedDetail, IThemeVariant, TVariantId } from './manager';
export type { IRoles } from './types';

/**
 * 为指定变体构造 Monaco 主题定义。
 * 封装"buildComponentTokens → buildMonacoTheme"管道细节，L4 消费者无需知晓 L3。
 */
export function buildMonacoThemeForVariant(variant: IThemeVariant) {
    const tokens = buildComponentTokens(variant.roles);
    return buildMonacoTheme(variant.roles, tokens, { mode: variant.mode });
}


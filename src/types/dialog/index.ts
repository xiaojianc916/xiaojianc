export type TAppDialogVariant = 'default' | 'warning' | 'danger';
export type TAppDialogAction = 'confirm' | 'cancel' | 'dismiss';

export interface IAppDialogOptions {
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  dismissText?: string;
  variant?: TAppDialogVariant;
}

export interface IAppDialogEventDetail extends IAppDialogOptions {
  id: string;
  onAction: (action: TAppDialogAction) => void;
}

export interface IAppDialogDismissDetail {
  id?: string;
  action?: TAppDialogAction;
}

/* 事件名常量 —— 值导出 */
export const APP_DIALOG_EVENT = 'app-dialog' as const;
export const APP_DIALOG_DISMISS_EVENT = 'app-dialog-dismiss' as const;

/* 唯一的 WindowEventMap 扩展入口，其他文件不要再声明 */
declare global {
  interface WindowEventMap {
    [APP_DIALOG_EVENT]: CustomEvent<IAppDialogEventDetail>;
    [APP_DIALOG_DISMISS_EVENT]: CustomEvent<IAppDialogDismissDetail | undefined>;
  }
}

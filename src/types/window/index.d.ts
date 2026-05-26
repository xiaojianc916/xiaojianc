import type { TAppWindowLabel } from '@/utils/app-window';

declare global {
  interface Window {
    __SH_RUNTIME_DIAGNOSTICS_CLEANUP__?: (() => void) | undefined;
    __SH_WINDOW_LABEL__?: TAppWindowLabel;
  }
}

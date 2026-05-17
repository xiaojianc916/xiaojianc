import type { ComputedRef, InjectionKey } from 'vue';

export interface ITerminalContext {
  output: ComputedRef<string>;
  isStreaming: ComputedRef<boolean>;
  autoScroll: ComputedRef<boolean>;
  copyOutput: () => Promise<void>;
  clearOutput: () => void;
}

export const TerminalKey: InjectionKey<ITerminalContext> = Symbol('Terminal');

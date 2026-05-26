import initShfmt, { format } from '@wasm-fmt/shfmt/vite';

let shfmtReadyPromise: Promise<void> | null = null;

const ensureShfmtReady = async (): Promise<void> => {
  if (!shfmtReadyPromise) {
    shfmtReadyPromise = initShfmt();
  }

  await shfmtReadyPromise;
};

export const formatShellScript = async (source: string, path?: string | null): Promise<string> => {
  await ensureShfmtReady();

  return format(source, path ?? 'untitled.sh', {
    indent: 2,
    simplify: true,
  });
};

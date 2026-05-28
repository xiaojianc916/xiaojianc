import {
  createRawTokens,
  highlightCode as highlightCodeSync,
  type ITokenizedCode,
  isBold,
  isItalic,
  isUnderline,
} from "@/services/editor/codemirror-static-highlight";

export type {
  ICodeMirrorHighlightToken,
  ITokenizedCode,
} from "@/services/editor/codemirror-static-highlight";
export { createRawTokens, isBold, isItalic, isUnderline };

export const highlightCode = (
  code: string,
  language: string,
  callback?: (result: ITokenizedCode) => void,
): ITokenizedCode | null => {
  const result = highlightCodeSync(code, language);
  if (result && callback) {
    queueMicrotask(() => callback(result));
  }

  return result;
};

declare module "monaco-editor/base/common/strings" {
  export class AmbiguousCharacters {
    static getInstance(locales: ReadonlySet<string>): AmbiguousCharacters;
    isAmbiguous(codePoint: number): boolean;
  }
  export const InvisibleCharacters: { readonly codePoints: ReadonlySet<number> };
}

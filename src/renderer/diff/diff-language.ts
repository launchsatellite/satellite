import { languages } from "monaco-editor/editor/editor.api";

export function diffLanguage(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const extension = dot === -1 ? undefined : name.slice(dot).toLowerCase();
  const found = languages
    .getLanguages()
    .find(
      (language) =>
        language.filenames?.includes(name) === true ||
        (extension !== undefined && language.extensions?.includes(extension) === true),
    );
  return found?.id ?? "plaintext";
}

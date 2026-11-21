export function assetInlineLimit(file: string): false | undefined {
  return file.endsWith(".svg") ? false : undefined;
}

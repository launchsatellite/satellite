import {
  fileExtensions,
  fileNames,
  folderNames,
  light,
} from "material-icon-theme/dist/material-icons.json";

type Table = ReadonlyMap<string, string>;

interface Scheme {
  names: readonly Table[];
  extensions: readonly Table[];
  folders: readonly Table[];
}

export interface IconIds {
  dark: string;
  light: string;
}

function table(entries: Readonly<Record<string, string>>): Table {
  return new Map(Object.entries(entries));
}

const darkScheme: Scheme = {
  names: [table(fileNames)],
  extensions: [table(fileExtensions)],
  folders: [table(folderNames)],
};
const lightScheme: Scheme = {
  names: [table(light.fileNames), table(fileNames)],
  extensions: [table(light.fileExtensions), table(fileExtensions)],
  folders: [table(light.folderNames), table(folderNames)],
};

function firstIn(tables: readonly Table[], key: string): string | undefined {
  for (const found of tables) {
    const id = found.get(key);
    if (id !== undefined) return id;
  }
  return undefined;
}

function fileId(name: string, scheme: Scheme): string {
  const lower = name.toLowerCase();
  const exact = firstIn(scheme.names, lower);
  if (exact !== undefined) return exact;
  for (let dot = lower.indexOf("."); dot !== -1; dot = lower.indexOf(".", dot + 1)) {
    const found = firstIn(scheme.extensions, lower.slice(dot + 1));
    if (found !== undefined) return found;
  }
  return "file";
}

function folderId(name: string, open: boolean, scheme: Scheme): string {
  const id = firstIn(scheme.folders, name.toLowerCase()) ?? "folder";
  if (!open) return id;
  return id.endsWith("_light") ? `${id.slice(0, -6)}-open_light` : `${id}-open`;
}

export function fileIconIds(name: string): IconIds {
  return { dark: fileId(name, darkScheme), light: fileId(name, lightScheme) };
}

export function folderIconIds(name: string, open: boolean): IconIds {
  return { dark: folderId(name, open, darkScheme), light: folderId(name, open, lightScheme) };
}

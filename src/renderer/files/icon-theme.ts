import { fileIconIds, folderIconIds, type IconIds } from "./icon-ids.ts";

export interface IconSources {
  src: string;
  lightSrc: string | undefined;
}

const urls = import.meta.glob<string>("../../../node_modules/material-icon-theme/icons/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});
const byId = new Map(
  Object.entries(urls).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1, -4), url]),
);

function urlOf(id: string): string | undefined {
  return byId.get(id) ?? byId.get(`${id}.clone`);
}

function sourcesOf({ dark, light }: IconIds): IconSources | undefined {
  const src = urlOf(dark);
  if (src === undefined) return undefined;
  const lightSrc = light === dark ? undefined : urlOf(light);
  return { src, lightSrc };
}

export function fileIcon(name: string): IconSources | undefined {
  return sourcesOf(fileIconIds(name));
}

export function folderIcon(name: string, open: boolean): IconSources | undefined {
  return sourcesOf(folderIconIds(name, open));
}

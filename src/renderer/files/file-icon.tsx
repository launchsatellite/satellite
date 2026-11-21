import { useEffect, useState } from "react";
import type * as IconTheme from "./icon-theme.ts";

export type LoadedIcons = typeof IconTheme;

let loaded: LoadedIcons | undefined;
let loading: Promise<LoadedIcons | undefined> | undefined;

function loadIcons(): Promise<LoadedIcons | undefined> {
  loading ??= import("./icon-theme.ts").then(
    (module) => {
      loaded = module;
      return module;
    },
    () => undefined,
  );
  return loading;
}

export function useIcons(): LoadedIcons | undefined {
  const [icons, setIcons] = useState(loaded);
  useEffect(() => {
    if (icons !== undefined) return;
    let stopped = false;
    void loadIcons().then((module) => {
      if (!stopped) setIcons(module);
    });
    return () => {
      stopped = true;
    };
  }, [icons]);
  return icons;
}

export function FileIcon({
  icons,
  name,
  folder,
  open,
}: {
  icons: LoadedIcons | undefined;
  name: string;
  folder: boolean;
  open: boolean;
}) {
  const sources =
    icons === undefined ? undefined : folder ? icons.folderIcon(name, open) : icons.fileIcon(name);
  if (sources === undefined) return <span aria-hidden className="size-4 flex-none" />;
  const image = (
    <img src={sources.src} alt="" width={16} height={16} draggable={false} className="size-4" />
  );
  return (
    <span aria-hidden className="flex size-4 flex-none">
      {sources.lightSrc === undefined ? (
        image
      ) : (
        <picture>
          <source media="(prefers-color-scheme: light)" srcSet={sources.lightSrc} />
          {image}
        </picture>
      )}
    </span>
  );
}

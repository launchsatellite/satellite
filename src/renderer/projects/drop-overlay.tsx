import { useEffect, useState } from "react";
import type { Notify } from "../ui/toast.tsx";

interface FolderDropOptions {
  accepts: (target: EventTarget | null) => boolean;
  onFolder: (path: string) => void;
  notify: Notify;
}

const oneAtATime = "Drop one folder at a time.";
const unreadable = "Satellite couldn't read where that came from. Use Add a project instead.";

function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") === true;
}

export function useFolderDrop({ accepts, onFolder, notify }: FolderDropOptions): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const over = (event: DragEvent) => {
      event.preventDefault();
      const wanted = carriesFiles(event) && accepts(event.target);
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = wanted ? "copy" : "none";
      setShown(wanted);
    };
    const leave = (event: DragEvent) => {
      if (event.relatedTarget === null) setShown(false);
    };
    const drop = (event: DragEvent) => {
      event.preventDefault();
      setShown(false);
      if (!carriesFiles(event) || !accepts(event.target)) return;
      const files = event.dataTransfer?.files;
      if (files !== undefined && files.length > 1) {
        notify(oneAtATime, "error");
        return;
      }
      const path = window.satellite.pathForFile(files?.[0]);
      if (path === "") {
        notify(unreadable, "error");
        return;
      }
      onFolder(path);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [accepts, onFolder, notify]);
  return shown;
}

export function DropOverlay() {
  return (
    <div
      data-testid="drop-overlay"
      className="pointer-events-none absolute inset-0 z-30 m-2 grid place-items-center rounded-[10px] border-2 border-dashed border-accent bg-bg/80"
    >
      <p className="text-[15px] font-semibold text-fg">Drop a folder to add it as a project</p>
    </div>
  );
}

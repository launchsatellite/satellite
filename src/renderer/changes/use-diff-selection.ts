import { useCallback, useRef, type RefObject } from "react";
import type { DiffHandle, DiffSelection } from "../diff/read-only-editor.tsx";

export function useDiffSelection(): {
  handle: RefObject<DiffHandle | null>;
  read: () => DiffSelection | null;
} {
  const handle = useRef<DiffHandle>(null);
  const read = useCallback(() => handle.current?.selection() ?? null, []);
  return { handle, read };
}

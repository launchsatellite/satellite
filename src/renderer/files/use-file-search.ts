import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceRef } from "../../shared/bridge-contract.ts";
import { invoke } from "../bridge/bridge-client.ts";

export interface FileSearch {
  query: string;
  state: "idle" | "searching" | "found" | "too-many" | "hung" | "failed";
  paths: readonly string[];
}

const typingPauseMs = 120;
const idle: FileSearch = { query: "", state: "idle", paths: [] };

export function useFileSearch(
  workspace: WorkspaceRef | null,
  active: boolean,
): { search: FileSearch; ask: (query: string) => void } {
  const [search, setSearch] = useState(idle);
  const latest = useRef("");
  const timer = useRef<number>(undefined);
  const projectId = workspace?.projectId;
  const key = workspace?.workspace;

  const stop = useCallback(() => {
    window.clearTimeout(timer.current);
    latest.current = "";
  }, []);

  const place = active ? `${String(projectId)}/${String(key)}` : null;
  const [shownPlace, setShownPlace] = useState(place);
  if (shownPlace !== place) {
    setShownPlace(place);
    setSearch(idle);
  }
  useEffect(() => stop, [place, stop]);

  const ask = useCallback(
    (query: string) => {
      window.clearTimeout(timer.current);
      latest.current = query;
      if (query === "" || projectId === undefined || key === undefined) {
        setSearch(idle);
        return;
      }
      setSearch((before) => ({ ...before, query, state: "searching" }));
      timer.current = window.setTimeout(() => {
        void invoke("files.find", { workspace: { projectId, workspace: key }, query }).then(
          (result) => {
            if (latest.current !== query) return;
            if (!result.ok) setSearch({ query, state: "failed", paths: [] });
            else if (result.value.kind === "found") {
              setSearch({ query, state: "found", paths: result.value.paths });
            } else setSearch({ query, state: result.value.kind, paths: [] });
          },
        );
      }, typingPauseMs);
    },
    [projectId, key],
  );

  return { search, ask };
}

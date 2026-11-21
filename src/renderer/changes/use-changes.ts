import { useEffect, useRef, useState } from "react";
import type { ChangesList, ChangesView, WorkspaceRef } from "../../shared/bridge-contract.ts";
import { invoke } from "../bridge/bridge-client.ts";

interface ListedPlace {
  place: string;
  list: ChangesList | undefined;
  error: string | null;
}

export function changesPlace(workspace: WorkspaceRef, view: ChangesView): string {
  return `${workspace.projectId}/${workspace.workspace}/${view}`;
}

export function useChanges(
  workspace: WorkspaceRef | null,
  view: ChangesView,
): { list: ChangesList | undefined; error: string | null } {
  const [listed, setListed] = useState<ListedPlace | null>(null);
  const sequence = useRef(0);
  const projectId = workspace?.projectId;
  const key = workspace?.workspace;
  const place = workspace === null ? null : changesPlace(workspace, view);

  useEffect(() => {
    sequence.current += 1;
    if (projectId === undefined || key === undefined || place === null) return;
    const asked = sequence.current;
    void invoke("changes.list", { workspace: { projectId, workspace: key }, view }).then(
      (result) => {
        if (asked !== sequence.current) return;
        setListed((current) => {
          const kept = current?.place === place ? current.list : undefined;
          return result.ok
            ? { place, list: result.value, error: null }
            : { place, list: kept, error: result.error.message };
        });
      },
    );
  }, [projectId, key, view, place]);

  if (listed?.place !== place) return { list: undefined, error: null };
  return { list: listed.list, error: listed.error };
}

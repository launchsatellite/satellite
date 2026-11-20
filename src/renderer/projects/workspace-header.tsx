import type { ProjectView, WorkspaceView } from "../../shared/bridge-contract.ts";
import { Icon } from "../ui/icon.tsx";
import { workspaceLabel } from "./use-projects.ts";

export function WorkspaceHeader({
  project,
  workspace,
}: {
  project: ProjectView;
  workspace: WorkspaceView;
}) {
  return (
    <header
      data-testid="workspace-header"
      className="flex h-11 min-w-0 flex-none items-center gap-[10px] border-b border-line pr-[10px] pl-4 whitespace-nowrap"
    >
      <h1 className="min-w-0 truncate text-[14px] font-semibold">{project.name}</h1>
      <span className="flex-none text-dim">
        <Icon name="branch" size={13} />
      </span>
      <span className="truncate font-mono text-[12px] text-dim">
        {workspaceLabel(project, workspace)}
      </span>
    </header>
  );
}

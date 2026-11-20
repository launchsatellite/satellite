import type { ProjectView, WorkspaceView } from "../../shared/bridge-contract.ts";
import { CommandButton } from "../commands/commands-context.tsx";
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
      <h1 className="max-w-[45%] min-w-10 truncate text-[14px] font-semibold">
        {workspace.name ?? project.name}
      </h1>
      {workspace.name !== null && (
        <span className="min-w-0 truncate text-[13px] text-dim">{project.name}</span>
      )}
      {project.missing === null && (
        <>
          <span className="flex-none text-dim">
            <Icon name="branch" size={13} />
          </span>
          <span className="min-w-0 truncate font-mono text-[12px] text-dim">
            {workspaceLabel(project, workspace)}
          </span>
        </>
      )}
      <span className="ml-auto flex flex-none items-center gap-1">
        {workspace.key !== "main" && (
          <CommandButton
            command="workspace.archive"
            variant="ghost"
            size="small"
            icon="archive"
            testId="archive-workspace"
          >
            Archive
          </CommandButton>
        )}
        <CommandButton
          command="project.remove"
          variant="ghost"
          size="small"
          testId="remove-project"
        />
      </span>
    </header>
  );
}

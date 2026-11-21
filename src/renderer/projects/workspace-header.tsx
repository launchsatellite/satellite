import type { ProjectView, WorkspaceView } from "../../shared/bridge-contract.ts";
import { visibleText } from "../../shared/visible-text.ts";
import { trackingWords } from "../changes/change-words.ts";
import { CommandButton } from "../commands/commands-context.tsx";
import { Icon } from "../ui/icon.tsx";
import { workspaceLabel } from "./use-projects.ts";

interface WorkspaceHeaderProps {
  project: ProjectView;
  workspace: WorkspaceView;
  base: string | null;
  ahead: number | null;
  behind: number | null;
}

export function WorkspaceHeader({ project, workspace, base, ahead, behind }: WorkspaceHeaderProps) {
  const tracking = trackingWords(ahead, behind);
  return (
    <header
      data-testid="workspace-header"
      className="@container flex h-11 min-w-0 flex-none items-center gap-[10px] border-b border-line pr-[10px] pl-4 whitespace-nowrap"
    >
      <h1 className="max-w-[45%] min-w-10 truncate text-[14px] font-semibold">
        {workspace.name ?? project.name}
      </h1>
      {workspace.name !== null && (
        <span className="hidden min-w-[4ch] truncate text-[13px] text-dim @md:block">
          {project.name}
        </span>
      )}
      {project.missing === null && (
        <span className="hidden min-w-[6ch] items-center gap-[10px] text-dim @sm:flex">
          <span className="flex-none">
            <Icon name="branch" size={13} />
          </span>
          <span dir="ltr" className="min-w-0 truncate font-mono text-[12px] [unicode-bidi:isolate]">
            {visibleText(workspaceLabel(project, workspace))}
          </span>
          {base !== null && (
            <span
              data-testid="workspace-base"
              dir="ltr"
              className="min-w-[6ch] truncate font-mono text-[12px] [unicode-bidi:isolate]"
            >
              from {visibleText(base)}
            </span>
          )}
          {tracking !== "" && (
            <span data-testid="workspace-tracking" className="flex flex-none items-center">
              <span className="sr-only">{tracking}</span>
              <span
                aria-hidden="true"
                className="flex gap-[7px] font-pixel text-[12px] text-dim uppercase"
              >
                {ahead !== null && <span>↑{ahead}</span>}
                {behind !== null && <span>↓{behind}</span>}
              </span>
            </span>
          )}
        </span>
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

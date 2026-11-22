import type { ProjectView, PullRequestFound, WorkspaceView } from "../../shared/bridge-contract.ts";
import { VisibleName } from "../ui/visible-name.tsx";
import { trackingWords } from "../changes/change-words.ts";
import { CommandButton } from "../commands/commands-context.tsx";
import { Icon } from "../ui/icon.tsx";
import { StatusPixel } from "../ui/status-pixel.tsx";
import {
  checksState,
  readoutLabel,
  readoutPixel,
  readoutRest,
} from "../pull-request/pull-request-words.ts";
import { countLabel } from "../processes/process-words.ts";
import { workspaceLabel } from "./use-projects.ts";

interface WorkspaceHeaderProps {
  project: ProjectView;
  workspace: WorkspaceView;
  base: string | null;
  ahead: number | null;
  behind: number | null;
  pullRequest: PullRequestFound | null;
  processes: number;
  onShowProcesses: () => void;
  onShowPullRequest: () => void;
}

export function WorkspaceHeader({
  project,
  workspace,
  base,
  ahead,
  behind,
  pullRequest,
  processes,
  onShowProcesses,
  onShowPullRequest,
}: WorkspaceHeaderProps) {
  const tracking = trackingWords(ahead, behind);
  return (
    <header
      data-testid="workspace-header"
      tabIndex={-1}
      className="@container focus:outline-none flex h-10 min-w-0 flex-none items-center gap-[10px] border-b border-line pr-[10px] pl-4 whitespace-nowrap"
    >
      <h1 className="max-w-[45%] min-w-10 truncate text-[14px] font-semibold">
        <VisibleName text={workspace.name ?? project.name} />
      </h1>
      {workspace.name !== null && (
        <span className="hidden min-w-[4ch] truncate text-[13px] text-dim @md:block">
          <VisibleName text={project.name} />
        </span>
      )}
      {project.missing === null && (
        <span className="hidden min-w-[6ch] items-center gap-[10px] text-dim @xs:flex">
          <span className="flex-none">
            <Icon name="branch" size={13} />
          </span>
          <span
            dir="ltr"
            className="min-w-[6ch] truncate font-mono text-[12px] [unicode-bidi:isolate]"
          >
            <VisibleName text={workspaceLabel(project, workspace)} />
          </span>
          {base !== null && (
            <span
              data-testid="workspace-base"
              dir="ltr"
              className="hidden min-w-0 shrink-[1000] truncate font-mono text-[12px] [unicode-bidi:isolate] @lg:block"
            >
              from <VisibleName text={base} />
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
      <span className="ml-auto flex min-w-0 flex-none items-center gap-1">
        {project.missing === null && processes > 0 && (
          <button
            type="button"
            data-testid="header-processes"
            data-count={processes}
            aria-label={countLabel(processes)}
            title={countLabel(processes)}
            onClick={onShowProcesses}
            className="flex h-6 min-w-0 flex-none items-center gap-[5px] rounded-[6px] px-[7px] font-pixel text-[12px] text-dim uppercase hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Icon name="running" size={13} />
            <span aria-hidden="true">{processes}</span>
          </button>
        )}
        {project.missing === null && pullRequest !== null && (
          <button
            type="button"
            data-testid="header-pull-request"
            data-number={pullRequest.number}
            data-checks={checksState(pullRequest.counts)}
            aria-label={readoutLabel(pullRequest)}
            title={readoutLabel(pullRequest)}
            onClick={onShowPullRequest}
            className="flex h-6 min-w-0 flex-none items-center gap-[7px] rounded-[6px] px-[7px] font-pixel text-[12px] text-dim uppercase hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <StatusPixel state={readoutPixel(pullRequest)} size={6} />
            <span aria-hidden="true" className="truncate">
              #{pullRequest.number}
              <span className="hidden @2xl:inline">{readoutRest(pullRequest)}</span>
            </span>
          </button>
        )}
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
        <span className={project.missing === null ? "hidden @3xl:flex" : "flex"}>
          <CommandButton
            command="project.remove"
            variant="ghost"
            size="small"
            testId="remove-project"
          />
        </span>
      </span>
    </header>
  );
}

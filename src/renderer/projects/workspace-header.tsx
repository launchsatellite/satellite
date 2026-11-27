import type { ReactNode } from "react";
import type { ProjectView, PullRequestFound, WorkspaceView } from "../../shared/bridge-contract.ts";
import { visibleText } from "../../shared/visible-text.ts";
import { VisibleName } from "../ui/visible-name.tsx";
import { trackingWords } from "../changes/change-words.ts";
import { CommandButton } from "../commands/commands-context.tsx";
import { Button } from "../ui/button.tsx";
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
  tabs: ReactNode;
}

const readoutButton = "min-w-0 flex-none px-[7px] font-pixel font-normal text-dim uppercase";

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
  tabs,
}: WorkspaceHeaderProps) {
  const tracking = trackingWords(ahead, behind);
  return (
    <header
      data-testid="workspace-header"
      tabIndex={-1}
      className={`@container focus:outline-none flex h-10 min-w-0 flex-none items-center gap-[10px] border-b border-line pr-[10px] whitespace-nowrap ${tabs === false ? "pl-4" : "pl-[7px]"}`}
    >
      <h1 className="sr-only">
        {workspace.name === null
          ? visibleText(project.name)
          : `${visibleText(project.name)} / ${workspace.name}`}
      </h1>
      {tabs}
      {project.missing === null && (
        <span className="ml-auto hidden min-w-[6ch] items-center gap-[10px] text-dim @lg:flex">
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
      <span className="ml-auto flex min-w-0 flex-none items-center gap-1 @lg:ml-0">
        {project.missing === null && processes > 0 && (
          <Button
            variant="ghost"
            size="small"
            testId="header-processes"
            data-count={processes}
            label={countLabel(processes)}
            tooltip={countLabel(processes)}
            onClick={onShowProcesses}
            className={`${readoutButton} gap-[5px]`}
          >
            <Icon name="running" size={13} />
            <span aria-hidden="true">{processes}</span>
          </Button>
        )}
        {project.missing === null && pullRequest !== null && (
          <Button
            variant="ghost"
            size="small"
            testId="header-pull-request"
            data-number={pullRequest.number}
            data-checks={checksState(pullRequest.counts)}
            label={readoutLabel(pullRequest)}
            tooltip={readoutLabel(pullRequest)}
            onClick={onShowPullRequest}
            className={`${readoutButton} gap-[7px]`}
          >
            <StatusPixel state={readoutPixel(pullRequest)} size={6} />
            <span aria-hidden="true" className="truncate">
              #{pullRequest.number}
              <span className="hidden @2xl:inline">{readoutRest(pullRequest)}</span>
            </span>
          </Button>
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

import type { ReactNode } from "react";
import type {
  ProjectView,
  PullRequestFound,
  WorkspaceKey,
  WorkspaceRef,
  WorkspaceView,
} from "../../shared/bridge-contract.ts";
import type { CommandId } from "../commands/command-registry.ts";
import { CommandButton, commandShortcut, useCommands } from "../commands/commands-context.tsx";
import { Button } from "../ui/button.tsx";
import { Icon, type IconName } from "../ui/icon.tsx";
import { KeyHint } from "../ui/key-hint.tsx";
import { PixelAvatar } from "../ui/pixel-avatar.tsx";
import { withUniqueTestIds } from "../ui/unique-test-ids.ts";
import { StatusPixel, type PixelState } from "../ui/status-pixel.tsx";
import { VisibleName } from "../ui/visible-name.tsx";
import { pixelLabel } from "../sessions/session-pixel.ts";
import { repeatedNames, shownParent } from "../../shared/project-names.ts";
import { visibleText } from "../../shared/visible-text.ts";
import { checksState, readoutLabel, readoutPixel } from "../pull-request/pull-request-words.ts";
import { countLabel } from "../processes/process-words.ts";
import { workspaceLabel } from "./use-projects.ts";
import { Tooltip } from "../ui/tooltip.tsx";

interface SidebarProps {
  projects: readonly ProjectView[] | undefined;
  selected: WorkspaceRef | null;
  onSelect: (ref: WorkspaceRef) => void;
  onNewWorkspace: (projectId: string) => void;
  focusProjectId: string | undefined;
  pixelFor: (projectId: string, workspace: WorkspaceKey) => PixelState;
  pullRequestFor: (ref: WorkspaceRef) => PullRequestFound | null;
  processesFor: (ref: WorkspaceRef) => number;
  inbox: ReactNode;
}
interface ProjectRow {
  project: ProjectView;
  testId: string;
  newWorkspaceTestId: string;
  workspaceTestIds: string[];
  showParent: boolean;
}

const countCap = 1_000_000;
const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function CommandRow({
  command,
  icon,
  text,
  testId,
}: {
  command: CommandId;
  icon: IconName;
  text: string;
  testId: string;
}) {
  const found = useCommands().get(command);
  const shortcut = found === undefined ? undefined : commandShortcut(found);
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={found?.run}
      className={`flex h-7 w-full flex-none items-center gap-[9px] rounded-[6px] px-2 text-[13px] font-medium whitespace-nowrap text-fg2 hover:bg-hover ${focusRing}`}
    >
      <span className="flex-none text-dim">
        <Icon name={icon} size={15} />
      </span>
      <span className="min-w-0 truncate">{text}</span>
      {shortcut !== undefined && (
        <span className="ml-auto flex-none">
          <KeyHint keys={shortcut} />
        </span>
      )}
    </button>
  );
}

function counted(count: number | null): string | undefined {
  if (count === null || count <= 0) return undefined;
  return count >= countCap ? `${String(countCap)}+` : String(count);
}

function uncommittedLabel(count: string): string {
  return count === "1" ? "1 uncommitted file" : `${count} uncommitted files`;
}

function Readouts({
  workspace,
  pullRequest,
  processes,
  testId,
}: {
  workspace: WorkspaceView;
  pullRequest: PullRequestFound | null;
  processes: number;
  testId: string | undefined;
}) {
  const ahead = counted(workspace.ahead);
  const behind = counted(workspace.behind);
  const changed = counted(workspace.changed);
  const parts = [
    ahead === undefined ? undefined : `${ahead} ahead`,
    behind === undefined ? undefined : `${behind} behind`,
    changed === undefined ? undefined : uncommittedLabel(changed),
    pullRequest === null ? undefined : readoutLabel(pullRequest),
    processes > 0 ? countLabel(processes) : undefined,
  ].filter((part) => part !== undefined);
  if (parts.length === 0) return null;
  return (
    <>
      <span className="sr-only">{parts.join(", ")}</span>
      <span
        data-testid={testId === undefined ? undefined : `${testId}-meta`}
        aria-hidden="true"
        className="ml-auto flex flex-none items-center gap-[7px] font-pixel text-[12px] text-dim uppercase"
      >
        {ahead !== undefined && <span>↑{ahead}</span>}
        {behind !== undefined && <span>↓{behind}</span>}
        {changed !== undefined && (
          <Tooltip text={uncommittedLabel(changed)}>
            <span className="flex items-center gap-[3px]">
              <Icon name="folder" size={12} />
              {changed}
            </span>
          </Tooltip>
        )}
        {pullRequest !== null && (
          <Tooltip text={readoutLabel(pullRequest)}>
            <span
              data-testid={testId === undefined ? undefined : `${testId}-pull-request`}
              data-number={pullRequest.number}
              data-checks={checksState(pullRequest.counts)}
              className="flex items-center gap-[5px]"
            >
              <StatusPixel state={readoutPixel(pullRequest)} size={6} />#{pullRequest.number}
            </span>
          </Tooltip>
        )}
        {processes > 0 && (
          <Tooltip text={countLabel(processes)}>
            <span
              data-testid={testId === undefined ? undefined : `${testId}-processes`}
              className="flex items-center gap-[3px]"
            >
              <Icon name="running" size={12} />
              {processes}
            </span>
          </Tooltip>
        )}
      </span>
    </>
  );
}

function projectRows(projects: readonly ProjectView[]): ProjectRow[] {
  const repeated = repeatedNames(projects);
  const rows = withUniqueTestIds(
    projects.map((project) => ({ project, testId: `project-${project.name}` })),
  );
  const workspaceIds = withUniqueTestIds(
    projects.flatMap((project) =>
      project.workspaces.map((workspace) => ({
        projectId: project.id,
        testId: `workspace-${project.name}-${workspace.name ?? "main"}`,
      })),
    ),
  );
  return rows.map((row) => ({
    ...row,
    newWorkspaceTestId: `new-workspace-${row.testId.slice("project-".length)}`,
    workspaceTestIds: workspaceIds
      .filter((workspace) => workspace.projectId === row.project.id)
      .map((workspace) => workspace.testId),
    showParent: shownParent(row.project, repeated) !== undefined,
  }));
}

function ProjectRows({
  row: { project, testId, newWorkspaceTestId, workspaceTestIds, showParent },
  guided,
  selected,
  onSelect,
  onNewWorkspace,
  focus,
  pixelFor,
  pullRequestFor,
  processesFor,
}: {
  row: ProjectRow;
  guided: boolean;
  selected: WorkspaceRef | null;
  onSelect: (ref: WorkspaceRef) => void;
  onNewWorkspace: (projectId: string) => void;
  focus: boolean;
  pixelFor: SidebarProps["pixelFor"];
  pullRequestFor: SidebarProps["pullRequestFor"];
  processesFor: SidebarProps["processesFor"];
}) {
  return (
    <>
      <div
        data-testid={testId}
        className="flex h-7 flex-none items-center gap-[9px] px-2 text-[13px] font-semibold whitespace-nowrap text-fg"
      >
        <PixelAvatar seed={project.id} />
        <span className="min-w-0 truncate">
          <VisibleName text={project.name} />
        </span>
        {showParent && (
          <span className="min-w-0 flex-[1_1_0%] truncate font-medium text-dim">
            <VisibleName text={project.parent} />
          </span>
        )}
        {project.missing !== null ? (
          <span className="ml-auto font-pixel text-[12px] text-dim uppercase">Missing</span>
        ) : (
          <span className="ml-auto flex flex-none" data-guide={guided ? "workspace" : undefined}>
            <Button
              variant="ghost"
              size="small"
              icon="plus"
              label={`New workspace in ${visibleText(project.name)}`}
              testId={newWorkspaceTestId}
              onClick={() => {
                onNewWorkspace(project.id);
              }}
            />
          </span>
        )}
      </div>
      <ul aria-label={visibleText(project.name)} className="flex flex-col gap-px">
        {project.workspaces.map((workspace, index) => {
          const current =
            selected?.projectId === project.id && selected.workspace === workspace.key;
          const pixel = pixelFor(project.id, workspace.key);
          const testId = workspaceTestIds[index];
          return (
            <li key={workspace.key}>
              <button
                type="button"
                data-testid={testId}
                autoFocus={focus}
                aria-current={current ? "true" : undefined}
                onClick={() => {
                  onSelect({ projectId: project.id, workspace: workspace.key });
                }}
                className={`flex h-7 w-full items-center gap-[9px] rounded-[6px] pr-2 pl-[33px] text-[13px] font-medium whitespace-nowrap ${current ? "bg-sel text-fg" : "text-fg2 hover:bg-hover"} ${focusRing}`}
              >
                <StatusPixel
                  state={pixel}
                  size={6}
                  testId={testId === undefined ? undefined : `${testId}-status`}
                  label={pixelLabel(pixel)}
                />
                <span
                  dir="ltr"
                  className={`min-w-0 truncate [unicode-bidi:isolate] ${current ? "font-semibold" : ""}`}
                >
                  <VisibleName text={workspaceLabel(project, workspace)} />
                </span>
                <Readouts
                  workspace={workspace}
                  pullRequest={pullRequestFor({ projectId: project.id, workspace: workspace.key })}
                  processes={processesFor({ projectId: project.id, workspace: workspace.key })}
                  testId={testId}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function guidedProject(
  projects: readonly ProjectView[],
  selected: WorkspaceRef | null,
): string | undefined {
  const present = projects.filter((project) => project.missing === null);
  const own = present.find((project) => project.id === selected?.projectId);
  return (own ?? present[0])?.id;
}

export function Sidebar({
  projects,
  selected,
  onSelect,
  onNewWorkspace,
  focusProjectId,
  pixelFor,
  pullRequestFor,
  processesFor,
  inbox,
}: SidebarProps) {
  const guided = guidedProject(projects ?? [], selected);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pt-2 pb-2">
      <CommandRow
        command="palette.commands"
        icon="keys"
        text="Commands"
        testId="open-command-menu"
      />
      <CommandRow
        command="palette.switcher"
        icon="search"
        text="Go to a workspace"
        testId="open-switcher"
      />
      {inbox}
      <div className="flex flex-none items-center justify-between px-2 pt-[14px] pb-1 text-[10px] font-semibold tracking-[0.12em] text-dim uppercase">
        Projects
        <CommandButton
          command="project.add"
          variant="ghost"
          size="small"
          icon="plus"
          label="Add a project"
          testId="add-project"
        />
      </div>
      {projects?.length === 0 && (
        <p data-testid="no-projects" className="px-2 py-1 text-[13px] text-dim">
          No projects yet.
        </p>
      )}
      {projects !== undefined && projects.length > 0 && (
        <nav aria-label="Projects" className="flex flex-col gap-px">
          {projectRows(projects).map((row) => (
            <ProjectRows
              key={row.project.id}
              row={row}
              guided={row.project.id === guided}
              selected={selected}
              onSelect={onSelect}
              onNewWorkspace={onNewWorkspace}
              focus={row.project.id === focusProjectId}
              pixelFor={pixelFor}
              pullRequestFor={pullRequestFor}
              processesFor={processesFor}
            />
          ))}
        </nav>
      )}
    </div>
  );
}

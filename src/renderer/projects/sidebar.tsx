import { useId, useState, type DragEvent, type ReactNode } from "react";
import type {
  ProjectView,
  PullRequestFound,
  WorkspaceKey,
  WorkspaceRef,
  WorkspaceView,
} from "../../shared/bridge-contract.ts";
import type { CommandId } from "../commands/command-registry.ts";
import { CommandButton, commandShortcut, useCommands } from "../commands/commands-context.tsx";
import { TopRow, type Frame } from "../window/top-row.tsx";
import { Button } from "../ui/button.tsx";
import { Icon, type IconName } from "../ui/icon.tsx";
import { KeyHint } from "../ui/key-hint.tsx";
import { Lockup } from "../ui/lockup.tsx";
import { rowLook, rowRing } from "../ui/row-look.ts";
import { Tooltip } from "../ui/tooltip.tsx";
import { withUniqueTestIds } from "../ui/unique-test-ids.ts";
import { StatusPixel, type PixelState } from "../ui/status-pixel.tsx";
import { VisibleName } from "../ui/visible-name.tsx";
import { mostUrgentPixel, pixelLabel } from "../sessions/session-pixel.ts";
import { repeatedNames, shownParent } from "../../shared/project-names.ts";
import { visibleText } from "../../shared/visible-text.ts";
import { checksState, readoutLabel, readoutPixel } from "../pull-request/pull-request-words.ts";
import { countLabel } from "../processes/process-words.ts";
import { workspaceLabel } from "./use-projects.ts";

interface SidebarProps {
  projects: readonly ProjectView[] | undefined;
  selected: WorkspaceRef | null;
  onSelect: (ref: WorkspaceRef) => void;
  onNewWorkspace: (projectId: string) => void;
  onRemoveProject: (project: ProjectView) => void;
  onArchive: (project: ProjectView, workspace: WorkspaceView) => void;
  onMove: (projectId: string, before: string | null) => void;
  focusProjectId: string | undefined;
  pixelFor: (projectId: string, workspace: WorkspaceKey) => PixelState;
  pullRequestFor: (ref: WorkspaceRef) => PullRequestFound | null;
  processesFor: (ref: WorkspaceRef) => number;
  hasSession: (ref: WorkspaceRef) => boolean;
  inbox: ReactNode;
  frameRight: number;
  frame: Frame;
}
interface ProjectRow {
  project: ProjectView;
  testId: string;
  newWorkspaceTestId: string;
  workspaceTestIds: string[];
  showParent: boolean;
}

const countCap = 1_000_000;
const projectDrag = "application/x-satellite-project";
const hoverAction = "opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100";

function CommandRow({
  command,
  icon,
  text,
  testId,
  className,
}: {
  command: CommandId;
  icon: IconName;
  text: string;
  testId: string;
  className: string;
}) {
  const found = useCommands().get(command);
  const shortcut = found === undefined ? undefined : commandShortcut(found);
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={found?.run}
      className={`flex h-7 min-w-0 items-center gap-2 rounded-[6px] px-2 text-[12.5px] whitespace-nowrap text-fg2 ${rowRing} ${className}`}
    >
      <span className="flex-none text-dim">
        <Icon name={icon} size={14} />
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

function readoutParts(
  workspace: WorkspaceView,
  pullRequest: PullRequestFound | null,
  processes: number,
): string[] {
  const ahead = counted(workspace.ahead);
  const behind = counted(workspace.behind);
  const changed = counted(workspace.changed);
  return [
    ahead === undefined ? undefined : `${ahead} ahead`,
    behind === undefined ? undefined : `${behind} behind`,
    changed === undefined ? undefined : uncommittedLabel(changed),
    pullRequest === null ? undefined : readoutLabel(pullRequest),
    processes > 0 ? countLabel(processes) : undefined,
  ].filter((part) => part !== undefined);
}

function Readout({
  workspace,
  pullRequest,
  processes,
  testId,
  givesWay,
}: {
  workspace: WorkspaceView;
  pullRequest: PullRequestFound | null;
  processes: number;
  testId: string | undefined;
  givesWay: boolean;
}) {
  const ahead = counted(workspace.ahead);
  const shown =
    pullRequest?.state === "merged" ? (
      <span data-testid={testId === undefined ? undefined : `${testId}-pull-request`}>merged</span>
    ) : pullRequest !== null ? (
      <span
        data-testid={testId === undefined ? undefined : `${testId}-pull-request`}
        data-number={pullRequest.number}
        data-checks={checksState(pullRequest.counts)}
        className="flex items-center gap-[5px]"
      >
        <StatusPixel state={readoutPixel(pullRequest)} size={6} />#{pullRequest.number}
      </span>
    ) : processes > 0 ? (
      <span
        data-testid={testId === undefined ? undefined : `${testId}-processes`}
        className="flex items-center gap-[3px]"
      >
        <Icon name="running" size={11} />
        {processes}
      </span>
    ) : ahead === undefined ? null : (
      <span>↑{ahead}</span>
    );
  if (shown === null) return null;
  return (
    <span
      data-testid={testId === undefined ? undefined : `${testId}-meta`}
      aria-hidden="true"
      className={`ml-auto flex flex-none items-center font-pixel text-[11px] text-dim uppercase ${givesWay ? "group-hover:invisible group-has-[:focus-visible]:invisible" : ""}`}
    >
      {shown}
    </span>
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

function FoldedReadout({ pixel, sessions }: { pixel: PixelState; sessions: number }) {
  if (sessions === 0 && pixel === "idle") return null;
  const label =
    sessions === 1 ? "1 workspace has a session" : `${String(sessions)} workspaces have a session`;
  return (
    <Tooltip text={sessions === 0 ? undefined : label}>
      <span className="flex items-center gap-[6px] font-pixel text-[11px] font-normal text-dim">
        <StatusPixel state={pixel} size={6} label={pixelLabel(pixel)} />
        {sessions > 0 && (
          <>
            <span aria-hidden="true">{sessions}</span>
            <span className="sr-only">{label}</span>
          </>
        )}
      </span>
    </Tooltip>
  );
}

function ProjectRows({
  row: { project, testId, newWorkspaceTestId, workspaceTestIds, showParent },
  folded,
  onFold,
  selected,
  onSelect,
  onNewWorkspace,
  onRemoveProject,
  onArchive,
  focus,
  pixelFor,
  pullRequestFor,
  processesFor,
  hasSession,
}: {
  row: ProjectRow;
  folded: boolean;
  onFold: (folded: boolean) => void;
  selected: WorkspaceRef | null;
  onSelect: (ref: WorkspaceRef) => void;
  onNewWorkspace: (projectId: string) => void;
  onRemoveProject: SidebarProps["onRemoveProject"];
  onArchive: SidebarProps["onArchive"];
  focus: boolean;
  pixelFor: SidebarProps["pixelFor"];
  pullRequestFor: SidebarProps["pullRequestFor"];
  processesFor: SidebarProps["processesFor"];
  hasSession: SidebarProps["hasSession"];
}) {
  const name = visibleText(project.name);
  const listId = useId();
  const refs = project.workspaces.map((workspace) => ({
    projectId: project.id,
    workspace: workspace.key,
  }));
  return (
    <>
      <div
        data-testid={testId}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(projectDrag, project.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        className="group flex h-7 flex-none cursor-grab items-center gap-[6px] pr-[2px] text-[13px] font-semibold whitespace-nowrap text-fg active:cursor-grabbing"
      >
        <button
          type="button"
          data-testid={`fold-${testId}`}
          aria-expanded={!folded}
          aria-controls={listId}
          onClick={() => {
            onFold(!folded);
          }}
          className={`flex h-7 min-w-0 flex-1 items-center gap-[6px] pl-2 text-left ${rowLook(false)} ${rowRing}`}
        >
          <span className="flex-none text-dim">
            <Icon name={folded ? "chevron-right" : "chevron-down"} size={12} />
          </span>
          <span className="min-w-0 truncate">
            <VisibleName text={project.name} />
          </span>
          {showParent && (
            <span className="min-w-0 flex-[1_1_0%] truncate font-medium text-dim">
              <VisibleName text={project.parent} />
            </span>
          )}
          {folded && (
            <span className="ml-auto flex flex-none">
              <FoldedReadout
                pixel={mostUrgentPixel(refs.map((ref) => pixelFor(ref.projectId, ref.workspace)))}
                sessions={refs.filter(hasSession).length}
              />
            </span>
          )}
        </button>
        <span className="flex flex-none items-center">
          <span className={`flex ${hoverAction}`}>
            <Button
              variant="ghost"
              size="small"
              icon="close"
              label={`Remove ${name}`}
              tooltip={`Remove ${name}`}
              testId={`remove-${testId}`}
              onClick={() => {
                onRemoveProject(project);
              }}
            />
          </span>
          {project.missing !== null ? (
            <span className="pl-1 font-pixel text-[11px] font-normal text-dim uppercase">
              Missing
            </span>
          ) : (
            <span className={`flex ${hoverAction}`}>
              <Button
                variant="ghost"
                size="small"
                icon="plus"
                label={`New workspace in ${name}`}
                tooltip={`New workspace in ${name}`}
                testId={newWorkspaceTestId}
                onClick={() => {
                  onNewWorkspace(project.id);
                }}
              />
            </span>
          )}
        </span>
      </div>
      <ul id={listId} hidden={folded} aria-label={name} className="flex flex-col gap-px">
        {project.workspaces.map((workspace, index) => {
          const ref = { projectId: project.id, workspace: workspace.key };
          const current =
            selected?.projectId === project.id && selected.workspace === workspace.key;
          const pixel = pixelFor(project.id, workspace.key);
          const testId = workspaceTestIds[index];
          const archivable =
            workspace.key !== "main" && !workspace.outside && project.missing === null;
          const pullRequest = pullRequestFor(ref);
          const processes = processesFor(ref);
          const summary = readoutParts(workspace, pullRequest, processes).join(", ");
          return (
            <li key={workspace.key} className="group relative">
              <Tooltip text={summary === "" ? undefined : summary}>
                <button
                  type="button"
                  data-testid={testId}
                  autoFocus={focus}
                  aria-current={current ? "true" : undefined}
                  onClick={() => {
                    onSelect(ref);
                  }}
                  className={`flex h-7 w-full items-center gap-2 pr-2 pl-[26px] text-[13px] whitespace-nowrap ${archivable ? "group-hover:pr-8 group-has-[:focus-visible]:pr-8" : ""} ${current ? "text-fg" : workspace.key === "main" ? "text-dim" : "text-fg2"} ${rowLook(current)} ${rowRing}`}
                >
                  <StatusPixel
                    state={pixel}
                    size={6}
                    testId={testId === undefined ? undefined : `${testId}-status`}
                    label={pixelLabel(pixel)}
                  />
                  <span
                    dir="ltr"
                    className={`min-w-0 truncate [unicode-bidi:isolate] ${current ? "font-medium" : ""}`}
                  >
                    <VisibleName text={workspaceLabel(project, workspace)} />
                  </span>
                  {summary !== "" && (
                    <span
                      data-testid={testId === undefined ? undefined : `${testId}-summary`}
                      className="sr-only"
                    >
                      {summary}
                    </span>
                  )}
                  <Readout
                    workspace={workspace}
                    pullRequest={pullRequest}
                    processes={processes}
                    testId={testId}
                    givesWay={archivable}
                  />
                </button>
              </Tooltip>
              {archivable && (
                <span className={`absolute inset-y-0 right-[2px] flex items-center ${hoverAction}`}>
                  <Button
                    variant="ghost"
                    size="small"
                    icon="archive"
                    label={`Archive ${workspaceLabel(project, workspace)}`}
                    tooltip="Archive this workspace"
                    testId={testId === undefined ? undefined : `archive-${testId}`}
                    onClick={() => {
                      onArchive(project, workspace);
                    }}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function dropBefore(
  event: DragEvent<HTMLElement>,
  projects: readonly ProjectView[],
  index: number,
  dragged: string | undefined,
): string | null | undefined {
  const box = event.currentTarget.getBoundingClientRect();
  const after = event.clientY > box.top + box.height / 2;
  const before = (after ? projects[index + 1] : projects[index])?.id ?? null;
  const at = projects.findIndex((project) => project.id === dragged);
  const stays = before === dragged || before === (projects[at + 1]?.id ?? null);
  return at === -1 || stays ? undefined : before;
}

export function Sidebar({
  projects,
  selected,
  onSelect,
  onNewWorkspace,
  onRemoveProject,
  onArchive,
  onMove,
  focusProjectId,
  pixelFor,
  pullRequestFor,
  processesFor,
  hasSession,
  inbox,
  frame,
  frameRight,
}: SidebarProps) {
  const [dropAt, setDropAt] = useState<string | null>();
  const [dragged, setDragged] = useState<string>();
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const fold = (projectId: string, shut: boolean) => {
    setFolded((current) => {
      const next = new Set(current);
      if (shut) next.add(projectId);
      else next.delete(projectId);
      return next;
    });
  };
  return (
    <>
      <TopRow
        frame={frame}
        left={0}
        right={frameRight}
        pad={[10, 8]}
        testId="sidebar-top"
        className="h-11"
      >
        <span className="flex-1" />
        <CommandButton
          command="sidebar.toggle"
          variant="ghost"
          size="small"
          icon="sidebar"
          label="Hide the sidebar"
          tooltip="Hide the sidebar"
          expanded
          controls="sidebar"
          testId="sidebar-toggle"
        />
      </TopRow>
      <div className="flex flex-none flex-col px-2">
        <Lockup testId="sidebar-lockup" />
        <span data-guide="workspace" className="flex pb-[10px]">
          <CommandButton
            command="workspace.new"
            icon="plus"
            testId="sidebar-new-workspace"
            className="w-full justify-start gap-[7px] px-[10px] text-[12.5px] [&>kbd]:ml-auto"
          />
        </span>
        <CommandRow
          command="palette.commands"
          icon="search"
          text="Search or run a command"
          testId="open-command-menu"
          className="mb-[14px] w-full bg-hover text-dim hover:text-fg2"
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-2">
        {inbox}
        <div className="mt-[6px] flex h-[26px] flex-none items-center justify-between pl-2 text-[11.5px] font-semibold text-dim">
          Repos
          <CommandButton
            command="project.add"
            variant="ghost"
            size="small"
            icon="plus"
            label="Add a repo"
            tooltip="Add a repo"
            testId="add-project"
          />
        </div>
        {projects?.length === 0 && (
          <p data-testid="no-projects" className="px-2 py-1 text-[13px] text-dim">
            No repos yet
          </p>
        )}
        {projects !== undefined && projects.length > 0 && (
          <nav
            aria-label="Repos"
            className="flex flex-col"
            onDragLeave={(event) => {
              const into = event.relatedTarget;
              if (!(into instanceof Node && event.currentTarget.contains(into)))
                setDropAt(undefined);
            }}
            onDragStart={(event) => {
              setDragged(event.dataTransfer.getData(projectDrag));
            }}
            onDragEnd={() => {
              setDropAt(undefined);
              setDragged(undefined);
            }}
          >
            {projectRows(projects).map((row, index) => (
              <div
                key={row.project.id}
                data-testid={`${row.testId}-group`}
                className={`flex flex-col gap-px border-t-2 ${dropAt === row.project.id ? "border-accent" : "border-transparent"}`}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes(projectDrag)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropAt(dropBefore(event, projects, index, dragged));
                }}
                onDrop={(event) => {
                  const moved = event.dataTransfer.getData(projectDrag);
                  if (moved === "") return;
                  event.preventDefault();
                  setDropAt(undefined);
                  const before = dropBefore(event, projects, index, moved);
                  if (before !== undefined) onMove(moved, before);
                }}
              >
                <ProjectRows
                  row={row}
                  folded={folded.has(row.project.id)}
                  onFold={(shut) => {
                    fold(row.project.id, shut);
                  }}
                  selected={selected}
                  onSelect={onSelect}
                  onNewWorkspace={onNewWorkspace}
                  onRemoveProject={onRemoveProject}
                  onArchive={onArchive}
                  focus={row.project.id === focusProjectId}
                  pixelFor={pixelFor}
                  pullRequestFor={pullRequestFor}
                  processesFor={processesFor}
                  hasSession={hasSession}
                />
              </div>
            ))}
            <div
              aria-hidden="true"
              className={`h-0 border-t-2 ${dropAt === null ? "border-accent" : "border-transparent"}`}
            />
          </nav>
        )}
      </div>
      <div className="mx-2 mb-2 flex flex-none items-center gap-[2px] border-t border-line pt-[6px]">
        <CommandRow
          command="agents.show"
          icon="agents"
          text="Agents"
          testId="open-agents"
          className={`flex-1 ${rowLook(false)}`}
        />
        <CommandButton
          command="settings.show"
          variant="ghost"
          icon="settings"
          label="Open settings"
          tooltip="Open settings"
          testId="sidebar-settings"
        />
      </div>
    </>
  );
}

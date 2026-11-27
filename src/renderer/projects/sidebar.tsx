import { useState, type DragEvent, type ReactNode } from "react";
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
import { Lockup } from "../ui/lockup.tsx";
import { rowLook, rowRing } from "../ui/row-look.ts";
import { Tooltip } from "../ui/tooltip.tsx";
import { withUniqueTestIds } from "../ui/unique-test-ids.ts";
import { StatusPixel, type PixelState } from "../ui/status-pixel.tsx";
import { VisibleName } from "../ui/visible-name.tsx";
import { pixelLabel } from "../sessions/session-pixel.ts";
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
const projectDrag = "application/x-satellite-project";
const hoverAction = "opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100";

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
      className={`flex h-7 w-full flex-none items-center gap-[9px] px-2 text-[13px] font-medium whitespace-nowrap text-fg2 ${rowLook(false)} ${rowRing}`}
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
  givesWay,
}: {
  workspace: WorkspaceView;
  pullRequest: PullRequestFound | null;
  processes: number;
  testId: string | undefined;
  givesWay: boolean;
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
        className={`ml-auto flex flex-none items-center gap-[7px] font-pixel text-[12px] text-dim uppercase ${givesWay ? "group-hover:invisible group-has-[:focus-visible]:invisible" : ""}`}
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
  onRemoveProject,
  onArchive,
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
  onRemoveProject: SidebarProps["onRemoveProject"];
  onArchive: SidebarProps["onArchive"];
  focus: boolean;
  pixelFor: SidebarProps["pixelFor"];
  pullRequestFor: SidebarProps["pullRequestFor"];
  processesFor: SidebarProps["processesFor"];
}) {
  const name = visibleText(project.name);
  return (
    <>
      <div
        data-testid={testId}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(projectDrag, project.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        className="group flex h-7 flex-none cursor-grab items-center gap-[9px] px-2 text-[13px] font-semibold whitespace-nowrap text-fg active:cursor-grabbing"
      >
        <span className="min-w-0 truncate">
          <VisibleName text={project.name} />
        </span>
        {showParent && (
          <span className="min-w-0 flex-[1_1_0%] truncate font-medium text-dim">
            <VisibleName text={project.parent} />
          </span>
        )}
        <span className="ml-auto flex flex-none items-center">
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
            <span className="pl-1 font-pixel text-[12px] text-dim uppercase">Missing</span>
          ) : (
            <span className="flex" data-guide={guided ? "workspace" : undefined}>
              <Button
                variant="ghost"
                size="small"
                icon="plus"
                label={`New workspace in ${name}`}
                testId={newWorkspaceTestId}
                onClick={() => {
                  onNewWorkspace(project.id);
                }}
              />
            </span>
          )}
        </span>
      </div>
      <ul aria-label={name} className="flex flex-col gap-px">
        {project.workspaces.map((workspace, index) => {
          const current =
            selected?.projectId === project.id && selected.workspace === workspace.key;
          const pixel = pixelFor(project.id, workspace.key);
          const testId = workspaceTestIds[index];
          const archivable =
            workspace.key !== "main" && !workspace.outside && project.missing === null;
          return (
            <li key={workspace.key} className="group relative">
              <button
                type="button"
                data-testid={testId}
                autoFocus={focus}
                aria-current={current ? "true" : undefined}
                onClick={() => {
                  onSelect({ projectId: project.id, workspace: workspace.key });
                }}
                className={`flex h-7 w-full items-center gap-[9px] px-2 text-[13px] font-medium whitespace-nowrap ${archivable ? "group-hover:pr-8 group-has-[:focus-visible]:pr-8" : ""} ${current ? "text-fg" : "text-fg2"} ${rowLook(current)} ${rowRing}`}
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
                  givesWay={archivable}
                />
              </button>
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
  onRemoveProject,
  onArchive,
  onMove,
  focusProjectId,
  pixelFor,
  pullRequestFor,
  processesFor,
  inbox,
}: SidebarProps) {
  const guided = guidedProject(projects ?? [], selected);
  const [dropAt, setDropAt] = useState<string | null>();
  const [dragged, setDragged] = useState<string>();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pt-1 pb-2">
      <Lockup testId="sidebar-lockup" />
      <CommandRow
        command="palette.commands"
        icon="keys"
        text="Commands"
        testId="open-command-menu"
      />
      <CommandRow command="palette.agents" icon="agents" text="Agents" testId="open-agents" />
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
        <nav
          aria-label="Projects"
          className="flex flex-col"
          onDragLeave={(event) => {
            const into = event.relatedTarget;
            if (!(into instanceof Node && event.currentTarget.contains(into))) setDropAt(undefined);
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
                guided={row.project.id === guided}
                selected={selected}
                onSelect={onSelect}
                onNewWorkspace={onNewWorkspace}
                onRemoveProject={onRemoveProject}
                onArchive={onArchive}
                focus={row.project.id === focusProjectId}
                pixelFor={pixelFor}
                pullRequestFor={pullRequestFor}
                processesFor={processesFor}
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
  );
}

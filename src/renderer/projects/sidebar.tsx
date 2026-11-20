import type { ProjectView, WorkspaceRef, WorkspaceView } from "../../shared/bridge-contract.ts";
import type { CommandId } from "../commands/command-registry.ts";
import { CommandButton, commandShortcut, useCommands } from "../commands/commands-context.tsx";
import { Icon, type IconName } from "../ui/icon.tsx";
import { KeyHint } from "../ui/key-hint.tsx";
import { PixelAvatar } from "../ui/pixel-avatar.tsx";
import { withUniqueTestIds } from "../ui/unique-test-ids.ts";
import { StatusPixel } from "../ui/status-pixel.tsx";
import { repeatedNames, workspaceLabel } from "./use-projects.ts";

interface SidebarProps {
  projects: readonly ProjectView[] | undefined;
  selected: WorkspaceRef | null;
  onSelect: (ref: WorkspaceRef) => void;
  focusProjectId: string | undefined;
}
interface ProjectRow {
  project: ProjectView;
  testId: string;
  workspaceTestIds: string[];
  showParent: boolean;
}

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

function Readouts({ workspace, testId }: { workspace: WorkspaceView; testId: string | undefined }) {
  const { ahead, behind, changed } = workspace;
  const parts = [
    ahead !== null && ahead > 0 ? `${String(ahead)} ahead` : undefined,
    behind !== null && behind > 0 ? `${String(behind)} behind` : undefined,
    changed !== null && changed > 0 ? `${String(changed)} changed files` : undefined,
  ].filter((part) => part !== undefined);
  if (parts.length === 0) return null;
  return (
    <span
      data-testid={testId === undefined ? undefined : `${testId}-meta`}
      aria-label={parts.join(", ")}
      className="ml-auto flex flex-none items-center gap-[7px] font-pixel text-[12px] text-dim uppercase"
    >
      {ahead !== null && ahead > 0 && <span aria-hidden="true">↑{ahead}</span>}
      {behind !== null && behind > 0 && <span aria-hidden="true">↓{behind}</span>}
      {changed !== null && changed > 0 && (
        <span aria-hidden="true" className="flex items-center gap-[3px]">
          <Icon name="folder" size={12} />
          {changed}
        </span>
      )}
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
    workspaceTestIds: workspaceIds
      .filter((workspace) => workspace.projectId === row.project.id)
      .map((workspace) => workspace.testId),
    showParent: repeated.has(row.project.name) && row.project.parent !== "",
  }));
}

function ProjectRows({
  row: { project, testId, workspaceTestIds, showParent },
  selected,
  onSelect,
  focus,
}: {
  row: ProjectRow;
  selected: WorkspaceRef | null;
  onSelect: (ref: WorkspaceRef) => void;
  focus: boolean;
}) {
  return (
    <>
      <div
        data-testid={testId}
        className="flex h-7 flex-none items-center gap-[9px] px-2 text-[13px] font-semibold whitespace-nowrap text-fg"
      >
        <PixelAvatar seed={project.id} />
        <span className="min-w-0 truncate">{project.name}</span>
        {showParent && (
          <span className="min-w-0 truncate font-medium text-dim">{project.parent}</span>
        )}
        {project.missing !== null && (
          <span className="ml-auto font-pixel text-[12px] text-dim uppercase">Missing</span>
        )}
      </div>
      <ul aria-label={project.name} className="flex flex-col gap-px">
        {project.workspaces.map((workspace, index) => {
          const current =
            selected?.projectId === project.id && selected.workspace === workspace.key;
          return (
            <li key={workspace.key}>
              <button
                type="button"
                data-testid={workspaceTestIds[index]}
                autoFocus={focus}
                aria-current={current ? "true" : undefined}
                onClick={() => {
                  onSelect({ projectId: project.id, workspace: workspace.key });
                }}
                className={`flex h-7 w-full items-center gap-[9px] rounded-[6px] pr-2 pl-[33px] text-[13px] font-medium whitespace-nowrap ${current ? "bg-sel text-fg" : "text-fg2 hover:bg-hover"} ${focusRing}`}
              >
                <StatusPixel state="idle" size={6} />
                <span className={`min-w-0 truncate ${current ? "font-semibold" : ""}`}>
                  {workspaceLabel(project, workspace)}
                </span>
                <Readouts workspace={workspace} testId={workspaceTestIds[index]} />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function Sidebar({ projects, selected, onSelect, focusProjectId }: SidebarProps) {
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
              selected={selected}
              onSelect={onSelect}
              focus={row.project.id === focusProjectId}
            />
          ))}
        </nav>
      )}
    </div>
  );
}

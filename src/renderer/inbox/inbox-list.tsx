import type { ProjectView, WorkspaceRef } from "../../shared/bridge-contract.ts";
import { workspaceLabel } from "../projects/use-projects.ts";
import { Icon } from "../ui/icon.tsx";
import { StatusPixel } from "../ui/status-pixel.tsx";
import { withUniqueTestIds } from "../ui/unique-test-ids.ts";
import { reasonSentence, type InboxRow } from "./inbox.ts";

interface InboxListProps {
  rows: readonly InboxRow[];
  projects: readonly ProjectView[];
  selected: WorkspaceRef | null;
  onOpen: (ref: WorkspaceRef) => void;
}
interface ShownRow {
  row: InboxRow;
  testId: string;
  label: string;
  project: string;
}

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function countSentence(count: number): string {
  if (count === 0) return "Nothing needs you.";
  return count === 1 ? "1 workspace needs you." : `${String(count)} workspaces need you.`;
}

function shownRows(rows: readonly InboxRow[], projects: readonly ProjectView[]): ShownRow[] {
  return withUniqueTestIds(
    rows.flatMap((row) => {
      const project = projects.find((listed) => listed.id === row.workspace.projectId);
      const workspace = project?.workspaces.find(
        (listed) => listed.key === row.workspace.workspace,
      );
      if (project === undefined || workspace === undefined) return [];
      return [
        {
          row,
          testId: `inbox-${project.name}-${workspace.name ?? "main"}`,
          label: workspaceLabel(project, workspace),
          project: project.name,
        },
      ];
    }),
  );
}

export function InboxList({ rows, projects, selected, onOpen }: InboxListProps) {
  const shown = shownRows(rows, projects);
  return (
    <section aria-label="Inbox" data-testid="inbox" className="flex flex-none flex-col gap-px">
      <div className="flex flex-none items-center justify-between px-2 pt-[14px] pb-1 text-[10px] font-semibold tracking-[0.12em] text-dim uppercase">
        <span className="flex items-center gap-[6px]">
          <Icon name="bell" size={12} />
          Inbox
        </span>
        <span
          data-testid="inbox-count"
          aria-hidden="true"
          className={`font-pixel text-[12px] tracking-normal ${shown.length > 0 ? "text-sigfg" : "text-dim"}`}
        >
          {shown.length}
        </span>
      </div>
      <span role="status" className="sr-only">
        {countSentence(shown.length)}
      </span>
      {shown.length === 0 ? (
        <p data-testid="inbox-empty" className="px-2 py-1 text-[13px] text-dim">
          Nothing needs you right now.
        </p>
      ) : (
        <ul aria-label="Inbox" className="flex flex-col gap-px">
          {shown.map(({ row, testId, label, project }) => {
            const { projectId, workspace } = row.workspace;
            const current = selected?.projectId === projectId && selected.workspace === workspace;
            return (
              <li key={`${projectId}/${workspace}`}>
                <button
                  type="button"
                  data-testid={testId}
                  aria-current={current ? "true" : undefined}
                  onClick={() => {
                    onOpen(row.workspace);
                  }}
                  className={`flex w-full items-start gap-[9px] rounded-[6px] px-2 py-[6px] text-left text-[13px] whitespace-nowrap ${current ? "bg-sel" : "hover:bg-hover"} ${focusRing}`}
                >
                  <span className="mt-[6px] flex flex-none">
                    <StatusPixel state="needs-you" size={6} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                    <span className="flex min-w-0 items-baseline gap-[6px]">
                      <span className="min-w-0 truncate font-medium text-fg">{label}</span>
                      <span className="min-w-0 truncate text-dim">{project}</span>
                    </span>
                    <span
                      data-testid={`${testId}-reason`}
                      className="min-w-0 truncate text-[12.5px] text-fg2"
                    >
                      {reasonSentence(row)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

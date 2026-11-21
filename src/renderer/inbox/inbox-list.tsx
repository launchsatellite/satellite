import { useLayoutEffect, useRef } from "react";
import type { ProjectView, WorkspaceRef, WorkspaceView } from "../../shared/bridge-contract.ts";
import { repeatedNames, shownProject } from "../../shared/project-names.ts";
import { workspaceLabel } from "../projects/use-projects.ts";
import { Icon } from "../ui/icon.tsx";
import { StatusPixel } from "../ui/status-pixel.tsx";
import { withUniqueTestIds } from "../ui/unique-test-ids.ts";
import { reasonSentence, type InboxRow, type InboxTarget } from "./inbox.ts";

interface InboxListProps {
  rows: readonly InboxRow[];
  projects: readonly ProjectView[];
  selected: WorkspaceRef | null;
  onOpen: (target: InboxTarget) => void;
}
interface ShownRow {
  key: string;
  row: InboxRow;
  testId: string;
  label: string;
  project: string;
  sentence: string;
}

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function countSentence(count: number): string {
  if (count === 0) return "Nothing needs you.";
  return count === 1 ? "1 workspace needs you." : `${String(count)} workspaces need you.`;
}

function rowLabel(project: ProjectView, workspace: WorkspaceView): string {
  return project.missing === null ? workspaceLabel(project, workspace) : (workspace.name ?? "main");
}

function shownRows(rows: readonly InboxRow[], projects: readonly ProjectView[]): ShownRow[] {
  const repeated = repeatedNames(projects);
  return withUniqueTestIds(
    rows.flatMap((row) => {
      const project = projects.find((listed) => listed.id === row.workspace.projectId);
      const workspace = project?.workspaces.find(
        (listed) => listed.key === row.workspace.workspace,
      );
      if (project === undefined || workspace === undefined) return [];
      return [
        {
          key: `${project.id}/${workspace.key}`,
          row,
          testId: `inbox-${project.name}-${workspace.name ?? "main"}`,
          label: rowLabel(project, workspace),
          project: shownProject(project, repeated),
          sentence: reasonSentence(row),
        },
      ];
    }),
  );
}

export function InboxList({ rows, projects, selected, onOpen }: InboxListProps) {
  const shown = shownRows(rows, projects);
  const keys = shown.map(({ key }) => key).join("\n");
  const section = useRef<HTMLElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const focused = useRef<string | null>(null);
  const before = useRef<string[]>([]);
  useLayoutEffect(() => {
    const now = keys === "" ? [] : keys.split("\n");
    const was = before.current;
    before.current = now;
    const key = focused.current;
    if (key === null || now.includes(key)) return;
    focused.current = null;
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected) return;
    const buttons = [...(list.current?.querySelectorAll("button") ?? [])];
    const next = buttons[Math.min(was.indexOf(key), buttons.length - 1)] ?? section.current;
    next?.focus();
  }, [keys]);
  return (
    <section
      ref={section}
      tabIndex={-1}
      aria-label="Inbox"
      data-testid="inbox"
      className={`flex flex-none flex-col gap-px rounded-[6px] ${focusRing}`}
    >
      <div className="flex flex-none items-center justify-between px-2 pt-[14px] pb-1 text-[10px] font-semibold tracking-[0.12em] text-dim uppercase">
        <span aria-hidden="true" className="flex items-center gap-[6px]">
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
        <ul
          ref={list}
          className="-m-[3px] flex max-h-[33vh] flex-col gap-px overflow-y-auto p-[3px]"
        >
          {shown.map(({ key, row, testId, label, project, sentence }) => {
            const { projectId, workspace } = row.workspace;
            const current = selected?.projectId === projectId && selected.workspace === workspace;
            const full = `${label}, ${project}. ${sentence}`;
            return (
              <li key={key}>
                <button
                  type="button"
                  data-testid={testId}
                  data-reason={row.reasons[0]?.kind}
                  aria-label={full}
                  title={full}
                  onFocus={() => {
                    focused.current = key;
                  }}
                  onBlur={(event) => {
                    if (event.currentTarget.isConnected) focused.current = null;
                  }}
                  onClick={() => {
                    const [oldest] = row.reasons;
                    if (oldest !== undefined) onOpen(oldest);
                  }}
                  className={`flex w-full items-start gap-[9px] rounded-[6px] px-2 py-[6px] text-left text-[13px] whitespace-nowrap ${current ? "bg-sel" : "hover:bg-hover"} ${focusRing}`}
                >
                  <span className="mt-[6px] flex flex-none">
                    <StatusPixel state="needs-you" size={6} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                    <span
                      data-testid={`${testId}-name`}
                      className="min-w-0 font-medium whitespace-normal text-fg wrap-anywhere"
                    >
                      {label}
                    </span>
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-[6px] text-[12.5px]">
                      <span className="max-w-full min-w-0 truncate text-dim">{project}</span>
                      <span data-testid={`${testId}-reason`} className="max-w-full min-w-0 whitespace-normal text-fg2">
                        {sentence}
                      </span>
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

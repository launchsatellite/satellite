import { useLayoutEffect, useRef } from "react";
import type { ProjectView, WorkspaceRef } from "../../shared/bridge-contract.ts";
import { repeatedNames, shownProject } from "../../shared/project-names.ts";
import { workspaceLabel } from "../projects/use-projects.ts";
import { StatusPixel } from "../ui/status-pixel.tsx";
import { rowLook, rowRing } from "../ui/row-look.ts";
import { Tooltip } from "../ui/tooltip.tsx";
import { withUniqueTestIds } from "../ui/unique-test-ids.ts";
import { VisibleName } from "../ui/visible-name.tsx";
import { reasonSentence, rowName, type InboxRow, type InboxTarget } from "./inbox.ts";

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
          label: workspaceLabel(project, workspace),
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
      aria-label="Needs you"
      data-testid="inbox"
      className={`flex flex-none flex-col gap-px rounded-[6px] ${focusRing}`}
    >
      <div
        data-guide="inbox"
        className="flex h-[26px] flex-none items-center justify-between px-2 text-[11.5px] font-semibold text-dim"
      >
        <span aria-hidden="true">Needs you</span>
        <span
          data-testid="inbox-count"
          aria-hidden="true"
          className={`font-pixel text-[11px] font-normal ${shown.length > 0 ? "text-sigfg" : "text-dim"}`}
        >
          {shown.length}
        </span>
      </div>
      <span role="status" className="sr-only">
        {countSentence(shown.length)}
      </span>
      {shown.length > 0 && (
        <ul
          ref={list}
          className="-m-1 flex max-h-[33vh] scroll-py-1 flex-col gap-px overflow-y-auto p-1"
        >
          {shown.map(({ key, row, testId, label, project, sentence }) => {
            const { projectId, workspace } = row.workspace;
            const current = selected?.projectId === projectId && selected.workspace === workspace;
            const full = rowName(label, project, sentence);
            return (
              <li key={key}>
                <Tooltip text={full}>
                  <button
                    type="button"
                    data-testid={testId}
                    data-reason={row.reasons[0]?.kind}
                    aria-label={full}
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
                    className={`flex w-full items-start gap-2 px-2 py-[6px] text-left text-[13px] whitespace-nowrap ${rowLook(current)} ${rowRing}`}
                  >
                    <span className="mt-[6px] flex flex-none">
                      <StatusPixel state="needs-you" size={6} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="flex min-w-0 flex-wrap items-baseline gap-x-[6px]">
                        <span
                          data-testid={`${testId}-name`}
                          className="min-w-0 whitespace-normal text-fg wrap-anywhere"
                        >
                          <VisibleName text={label} />
                        </span>
                        <span className="max-w-full min-w-0 truncate text-[12px] text-dim">
                          {project}
                        </span>
                      </span>
                      <span
                        data-testid={`${testId}-reason`}
                        className="min-w-0 text-[12px] whitespace-normal text-dim"
                      >
                        {sentence}
                      </span>
                    </span>
                  </button>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

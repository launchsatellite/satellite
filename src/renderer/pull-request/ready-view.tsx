import type { PullRequestFound, WorkspaceRef } from "../../shared/bridge-contract.ts";
import { visibleText } from "../../shared/visible-text.ts";
import { railPanelId, railTabId } from "../rail/rail.tsx";
import { sendToClaudeCode } from "../sessions/send-to-claude-code.ts";
import { Button } from "../ui/button.tsx";
import { Icon } from "../ui/icon.tsx";
import { StatusPixel, type PixelState } from "../ui/status-pixel.tsx";
import { VisibleName } from "../ui/visible-name.tsx";
import { FailedChecks } from "./failed-checks.tsx";
import { Sentence } from "./pull-request-sentence.tsx";
import { openRequest } from "./pull-request-requests.ts";
import {
  absentSentence,
  loadingSentence,
  moreSentence,
  sendLabel,
  troubleSentence,
} from "./pull-request-words.ts";
import { blocks, readyCard, type CardLook, type ReadyRow, type RowLook } from "./ready-rows.ts";
import { foundOf, type PullRequestEntry } from "./use-pull-requests.ts";

interface ReadyViewProps {
  entry: PullRequestEntry | undefined;
  workspace: WorkspaceRef;
  onLink: (address: string) => void;
}

const cardPixels: Record<CardLook, PixelState> = {
  clear: "ready",
  signal: "needs-you",
  blocks: "idle",
  merged: "done",
  closed: "idle",
};
const rowMarks: Record<RowLook, string> = {
  clear: "text-volt-edge",
  signal: "text-sigfg",
  blocks: "text-dim",
  open: "text-dim",
};

function isHttps(address: string): boolean {
  return URL.parse(address)?.protocol === "https:";
}

function Card({ found, look, title }: { found: PullRequestFound; look: CardLook; title: string }) {
  const edge =
    look === "signal" ? "border-[color-mix(in_srgb,var(--signal)_40%,var(--line))]" : "border-line";
  return (
    <section
      data-testid="ready-card"
      data-look={look}
      aria-labelledby="ready-card-title"
      className={`mx-1 mb-3 rounded-[10px] border bg-bg px-[14px] pt-[14px] pb-3 ${edge}`}
    >
      <h2
        id="ready-card-title"
        className="flex items-center gap-[10px] text-[15px] leading-5 font-semibold text-fg"
      >
        <StatusPixel state={cardPixels[look]} />
        <span data-testid="ready-title">{title}</span>
      </h2>
      <p className="mt-1 ml-[18px] flex min-w-0 items-center gap-[6px] text-[12px] text-dim">
        <span className="flex-none font-pixel uppercase">#{found.number}</span>
        {found.head !== null && found.base !== null && (
          <>
            <span aria-hidden="true">·</span>
            <span
              data-testid="ready-branches"
              dir="ltr"
              className="min-w-0 truncate font-mono text-fg2 [unicode-bidi:isolate]"
            >
              <VisibleName text={found.head} /> → <VisibleName text={found.base} />
            </span>
          </>
        )}
      </p>
    </section>
  );
}

function Row({
  row,
  found,
  workspace,
  onLink,
}: {
  row: ReadyRow;
  found: PullRequestFound;
  workspace: WorkspaceRef;
  onLink: (address: string) => void;
}) {
  const { key, look, title, detail, count, request } = row;
  return (
    <li
      data-testid={`ready-row-${key}`}
      data-look={look}
      data-blocks={blocks(row) ? "true" : "false"}
      className="flex flex-col"
    >
      <div className="flex min-h-8 items-center gap-[10px] rounded-[6px] px-[6px] py-[6px]">
        <span className={`flex-none ${rowMarks[look]}`}>
          <Icon name={look === "clear" ? "check" : "close"} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            data-testid={`ready-row-${key}-title`}
            className={`block text-[13px] break-words ${look === "signal" ? "text-fg" : "text-fg2"}`}
          >
            {title}
          </span>
          {detail !== null && detail !== "" && (
            <span className="mt-px block text-[11.5px] break-words text-dim">{detail}</span>
          )}
        </span>
        {count !== null && (
          <span className="flex-none font-pixel text-[11px] text-dim">{count}</span>
        )}
      </div>
      {key === "checks" && look === "signal" && (
        <FailedChecks workspace={workspace} found={found} onLink={onLink} />
      )}
      {request !== null && (
        <div className="flex pt-[2px] pb-2 pl-[30px]">
          <Button
            variant="secondary"
            size="small"
            testId={`ready-send-${key}`}
            onClick={() => {
              sendToClaudeCode(request);
            }}
          >
            {sendLabel}
          </Button>
        </div>
      )}
    </li>
  );
}

function Commits({ found }: { found: PullRequestFound }) {
  return (
    <section aria-labelledby="ready-commits-label" className="flex flex-col">
      <h3
        id="ready-commits-label"
        className="flex items-center px-2 pt-3 pb-1 text-[11.5px] font-semibold text-dim"
      >
        Commits
        <span className="ml-auto font-pixel text-[11px] font-normal">
          {found.commits.length + found.moreCommits}
        </span>
      </h3>
      <ul data-testid="ready-commits" className="flex flex-col">
        {found.commits.map((commit, index) => (
          <li
            key={`${commit.oid}-${String(index)}`}
            data-testid={`ready-commit-${String(index)}`}
            className="flex h-7 min-w-0 items-center gap-[10px] px-2 text-[12.5px]"
          >
            <span className="flex-none font-mono text-[11px] text-dim">{commit.oid}</span>
            <span dir="ltr" className="min-w-0 truncate text-fg2 [unicode-bidi:isolate]">
              {commit.headline === "" ? "No message" : visibleText(commit.headline)}
            </span>
          </li>
        ))}
      </ul>
      {found.moreCommits > 0 && (
        <p className="px-2 py-1 text-[12px] text-dim">{moreSentence(found.moreCommits)}</p>
      )}
    </section>
  );
}

function Found({
  found,
  workspace,
  onLink,
}: {
  found: PullRequestFound;
  workspace: WorkspaceRef;
  onLink: (address: string) => void;
}) {
  const card = readyCard(found);
  const merge = card.look === "clear";
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-2">
        <Card found={found} look={card.look} title={card.title} />
        {card.rows.length > 0 && (
          <ul aria-label="What the merge waits on" className="flex flex-col">
            {card.rows.map((row) => (
              <Row key={row.key} row={row} found={found} workspace={workspace} onLink={onLink} />
            ))}
          </ul>
        )}
        <Commits found={found} />
      </div>
      {isHttps(found.url) && (
        <div className="flex flex-none flex-col border-t border-line p-2">
          <Button
            variant={merge ? "primary" : "secondary"}
            testId={merge ? "ready-merge" : "ready-open"}
            className="justify-center"
            onClick={() => {
              onLink(found.url);
            }}
          >
            {merge ? "Merge on GitHub" : "Open on GitHub"}
          </Button>
        </div>
      )}
    </>
  );
}

export function ReadyView({ entry, workspace, onLink }: ReadyViewProps) {
  const answer = entry?.answer ?? null;
  const found = foundOf(entry);
  const trouble = answer?.kind === "unavailable" && found !== null ? answer.reason : null;
  const state =
    found !== null
      ? "found"
      : answer === null
        ? "loading"
        : answer.kind === "absent"
          ? "absent"
          : "unavailable";
  const body = () => {
    if (found !== null) return <Found found={found} workspace={workspace} onLink={onLink} />;
    if (answer === null) return <Sentence testId="pull-request-loading" text={loadingSentence} />;
    if (answer.kind === "unavailable") {
      return <Sentence testId="pull-request-sentence" text={troubleSentence(answer.reason)} />;
    }
    if (answer.kind === "absent") {
      return (
        <Sentence testId="pull-request-sentence" text={absentSentence(answer.reason)}>
          {answer.reason !== "target" && (
            <Button
              variant="secondary"
              size="small"
              testId="pull-request-send-open"
              onClick={() => {
                sendToClaudeCode(openRequest());
              }}
            >
              {sendLabel}
            </Button>
          )}
        </Sentence>
      );
    }
    return null;
  };
  return (
    <div
      data-testid="ready"
      data-state={state}
      role="tabpanel"
      id={railPanelId("ready")}
      aria-labelledby={railTabId("ready")}
      className="flex min-h-0 flex-1 flex-col"
    >
      {trouble !== null && (
        <p
          data-testid="pull-request-stale"
          role="status"
          className="flex-none border-b border-line bg-side px-4 py-2 text-[12px] text-fg2"
        >
          {troubleSentence(trouble)}
        </p>
      )}
      {body()}
    </div>
  );
}

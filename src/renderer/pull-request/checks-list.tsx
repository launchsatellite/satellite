import { useEffect, useRef, useState } from "react";
import type {
  BridgeResponse,
  PullRequestCheck,
  PullRequestFound,
  WorkspaceRef,
} from "../../shared/bridge-contract.ts";
import { revealLines } from "../../shared/visible-text.ts";
import { invoke } from "../bridge/bridge-client.ts";
import { sendToClaudeCode } from "../sessions/send-to-claude-code.ts";
import { Button } from "../ui/button.tsx";
import { StatusPixel } from "../ui/status-pixel.tsx";
import { VisibleName } from "../ui/visible-name.tsx";
import { checkRequest } from "./pull-request-requests.ts";
import {
  emptyLogSentence,
  largeLogSentence,
  logCutSentence,
  moreSentence,
  noChecksSentence,
  noLogSentence,
  openLabel,
  readingLogSentence,
  resultPixel,
  resultWord,
  runningChecksSentence,
  sendLabel,
  troubleSentence,
  unnamedCheck,
} from "./pull-request-words.ts";

type LogAnswer = BridgeResponse<"pullRequest.log">;
interface LogState {
  open: boolean;
  answer: LogAnswer | null;
}
interface Logs {
  head: string;
  byJob: ReadonlyMap<string, LogState>;
}

const unreadable: LogAnswer = { kind: "unavailable", reason: "failed" };

function headOf(found: PullRequestFound): string {
  return `${String(found.number)}/${found.commits.at(-1)?.oid ?? ""}/${String(found.moreCommits)}`;
}

function LogBody({ state, testId }: { state: LogState; testId: string }) {
  const { answer } = state;
  if (answer === null) {
    return (
      <p role="status" className="text-[12px] text-dim">
        {readingLogSentence}
      </p>
    );
  }
  if (answer.kind === "lines") {
    return (
      <>
        <pre
          tabIndex={0}
          aria-label="Failing lines"
          data-testid={`${testId}-text`}
          className="max-h-64 overflow-auto rounded-[6px] border border-line bg-side p-2 font-mono text-[12px] leading-[18px] break-words whitespace-pre-wrap text-fg2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {revealLines(answer.lines.join("\n")).text}
        </pre>
        {answer.more && <p className="text-[12px] text-dim">{logCutSentence}</p>}
      </>
    );
  }
  return (
    <p className="text-[12px] text-fg2">
      {answer.kind === "empty" && emptyLogSentence}
      {answer.kind === "too-large" && largeLogSentence}
      {answer.kind === "unavailable" && troubleSentence(answer.reason)}
    </p>
  );
}

function CheckRow({
  index,
  check,
  found,
  state,
  onToggle,
  onLink,
}: {
  index: number;
  check: PullRequestCheck;
  found: PullRequestFound;
  state: LogState | undefined;
  onToggle: (job: string) => void;
  onLink: (address: string) => void;
}) {
  const id = `pull-request-check-${String(index)}`;
  const failed = check.result === "failed";
  const job = check.job;
  const open = state?.open === true;
  return (
    <li
      data-testid={id}
      data-result={check.result}
      className="flex flex-col gap-2 border-b border-line px-4 py-2 last:border-b-0"
    >
      <div className="flex min-h-6 flex-wrap items-center gap-x-[9px] gap-y-1 text-[13px]">
        <StatusPixel state={resultPixel(check.result)} size={6} />
        <span dir="ltr" className="min-w-0 break-words text-fg [unicode-bidi:isolate]">
          {check.name === "" ? unnamedCheck : <VisibleName text={check.name} />}
        </span>
        {check.workflow !== null && check.workflow !== "" && (
          <span dir="ltr" className="min-w-0 truncate text-dim [unicode-bidi:isolate]">
            <VisibleName text={check.workflow} />
          </span>
        )}
        <span className="font-pixel text-[11px] text-fg2 uppercase">
          {resultWord(check.result)}
        </span>
        <span className="ml-auto flex flex-wrap items-center justify-end gap-[6px]">
          {failed && job !== null && (
            <Button
              variant="secondary"
              size="small"
              testId={`${id}-toggle`}
              expanded={open}
              controls={`${id}-lines`}
              onClick={() => {
                onToggle(job);
              }}
            >
              {open ? "Hide failing lines" : "Show failing lines"}
            </Button>
          )}
          {failed && (
            <Button
              variant="secondary"
              size="small"
              testId={`${id}-send`}
              onClick={() => {
                sendToClaudeCode(checkRequest(found.number, check.run, check.job));
              }}
            >
              {sendLabel}
            </Button>
          )}
          {check.url !== null && (
            <Button
              variant="ghost"
              size="small"
              testId={`${id}-open`}
              onClick={() => {
                if (check.url !== null) onLink(check.url);
              }}
            >
              {openLabel(found.host, check.url, "Open check details")}
            </Button>
          )}
        </span>
      </div>
      {failed && job === null && <p className="text-[12px] text-dim">{noLogSentence}</p>}
      {failed && job !== null && open && (
        <div
          id={`${id}-lines`}
          data-testid={state.answer === null ? undefined : `${id}-lines`}
          className="flex flex-col gap-1"
        >
          <LogBody state={state} testId={`${id}-lines`} />
        </div>
      )}
    </li>
  );
}

export function ChecksList({
  workspace,
  found,
  onLink,
}: {
  workspace: WorkspaceRef;
  found: PullRequestFound;
  onLink: (address: string) => void;
}) {
  const head = headOf(found);
  const [logs, setLogs] = useState<Logs>({ head, byJob: new Map() });
  const byJob = logs.head === head ? logs.byJob : new Map<string, LogState>();
  const latest = useRef(head);
  useEffect(() => {
    latest.current = head;
  });
  const change = (job: string, next: LogState) => {
    setLogs((current) => {
      const base = current.head === head ? current.byJob : new Map<string, LogState>();
      return { head, byJob: new Map(base).set(job, next) };
    });
  };
  const toggle = (job: string) => {
    const now = byJob.get(job);
    if (now?.open === true) {
      change(job, { open: false, answer: now.answer });
      return;
    }
    const kept = now?.answer?.kind === "unavailable" ? null : (now?.answer ?? null);
    change(job, { open: true, answer: kept });
    if (kept !== null) return;
    void invoke("pullRequest.log", { workspace, job }).then((result) => {
      if (latest.current === head)
        change(job, { open: true, answer: result.ok ? result.value : unreadable });
    });
  };
  if (found.checks.length === 0) {
    return (
      <p data-testid="pull-request-checks" className="px-4 py-3 text-[13px] text-dim">
        {noChecksSentence}
      </p>
    );
  }
  return (
    <div data-testid="pull-request-checks" className="flex flex-col">
      <ul className="flex flex-col">
        {found.checks.map((check, index) => (
          <CheckRow
            key={`${check.job ?? check.url ?? check.name}-${String(index)}`}
            index={index}
            check={check}
            found={found}
            state={check.job === null ? undefined : byJob.get(check.job)}
            onToggle={toggle}
            onLink={onLink}
          />
        ))}
      </ul>
      {found.moreChecks > 0 && (
        <p className="px-4 py-2 text-[12px] text-dim">{moreSentence(found.moreChecks)}</p>
      )}
      {found.counts.pending > 0 && (
        <p className="px-4 py-2 text-[12px] text-dim">{runningChecksSentence}</p>
      )}
    </div>
  );
}

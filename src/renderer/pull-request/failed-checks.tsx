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
import { VisibleName } from "../ui/visible-name.tsx";
import { checkRequest } from "./pull-request-requests.ts";
import {
  emptyLogSentence,
  largeLogSentence,
  logCutSentence,
  noLogSentence,
  openLabel,
  readingLogSentence,
  sendLabel,
  troubleSentence,
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

const unnamedCheck = "Unnamed check";
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
  const job = check.job;
  const open = state?.open === true;
  return (
    <li data-testid={id} data-result={check.result} className="flex flex-col gap-[6px]">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-[9px] text-[12px]">
        <span dir="ltr" className="min-w-0 break-words text-fg2 [unicode-bidi:isolate]">
          {check.name === "" ? unnamedCheck : <VisibleName text={check.name} />}
        </span>
        {check.workflow !== null && check.workflow !== "" && (
          <span dir="ltr" className="min-w-0 truncate text-dim [unicode-bidi:isolate]">
            <VisibleName text={check.workflow} />
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-[6px]">
        {job !== null && (
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
      </div>
      {job === null && <p className="text-[12px] text-dim">{noLogSentence}</p>}
      {job !== null && open && (
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

export function FailedChecks({
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
  return (
    <ul data-testid="ready-failed-checks" className="flex flex-col gap-3 pt-1 pr-1 pb-2 pl-[30px]">
      {found.checks.map((check, index) =>
        check.result === "failed" ? (
          <CheckRow
            key={`${check.job ?? check.url ?? check.name}-${String(index)}`}
            index={index}
            check={check}
            found={found}
            state={check.job === null ? undefined : byJob.get(check.job)}
            onToggle={toggle}
            onLink={onLink}
          />
        ) : null,
      )}
    </ul>
  );
}

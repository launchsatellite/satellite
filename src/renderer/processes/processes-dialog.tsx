import { Fragment, useEffect, useRef, useState } from "react";
import type { ProcessRow } from "../../shared/bridge-contract.ts";
import { visibleText } from "../../shared/visible-text.ts";
import { Button } from "../ui/button.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { stopKey } from "./use-processes.ts";
import {
  ageReadout,
  ageWords,
  detachedSentence,
  moreSentence,
  nothingRunning,
  portLabel,
} from "./process-words.ts";

interface ProcessesDialogProps {
  label: string;
  rows: readonly ProcessRow[];
  more: number;
  sessionNumber: (terminalId: string) => number | undefined;
  stopping: ReadonlySet<string>;
  problem: string | null;
  onStop: (row: ProcessRow) => void;
  onPort: (url: string) => void;
  onClose: () => void;
}

const note = "text-[12px] text-dim";
const separatorEnd = /(?<=[^\s/\\][/\\])(?=[^/\\])/;
const ringed =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function sessionName(number: number | undefined): string {
  return number === undefined ? "A session" : `Session ${String(number)}`;
}

function Row({
  row,
  index,
  now,
  number,
  stopping,
  busy,
  onStop,
  onPort,
}: {
  row: ProcessRow;
  index: number;
  now: number;
  number: number | undefined;
  stopping: boolean;
  busy: boolean;
  onStop: () => void;
  onPort: (url: string) => void;
}) {
  const testId = `process-row-${String(index)}`;
  const command = visibleText(row.command);
  const shown = `${command}${row.cut ? "…" : ""}`;
  const age = now - row.started;
  return (
    <li
      data-testid={testId}
      data-pid={row.pid}
      className="flex items-start gap-3 border-b border-line py-2 first:pt-0 last:border-b-0 last:pb-0"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p
          data-testid={`${testId}-command`}
          title={shown}
          className="font-mono text-[12px] [overflow-wrap:anywhere] text-fg"
        >
          {command.split(separatorEnd).map((part, position) => (
            <Fragment key={position}>
              {position > 0 && <wbr />}
              {part}
            </Fragment>
          ))}
          {row.cut ? "…" : ""}
        </p>
        <p className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${note}`}>
          <span data-testid={`${testId}-session`}>{sessionName(number)}</span>
          <span data-testid={`${testId}-age`}>
            <span className="sr-only">running for {ageWords(age)}</span>
            <span aria-hidden="true" className="font-pixel uppercase tabular-nums">
              {ageReadout(age)}
            </span>
          </span>
          {row.ports.map(({ port, url }) =>
            url === null ? (
              <span
                key={port}
                data-testid={`${testId}-port-${String(port)}`}
                data-link="false"
                title={portLabel(port, false)}
              >
                <span className="sr-only">{portLabel(port, false)}</span>
                <span aria-hidden="true" className="font-pixel text-dim">
                  :{port}
                </span>
              </span>
            ) : (
              <button
                key={port}
                type="button"
                data-testid={`${testId}-port-${String(port)}`}
                data-link="true"
                title={portLabel(port, true)}
                aria-label={portLabel(port, true)}
                onClick={() => {
                  onPort(url);
                }}
                className={`-mx-1 rounded-[6px] px-1 font-pixel text-fg underline underline-offset-[3px] hover:bg-hover ${ringed}`}
              >
                :{port}
              </button>
            ),
          )}
        </p>
      </div>
      <Button
        variant="secondary"
        size="small"
        testId={`${testId}-stop`}
        disabled={busy}
        onClick={onStop}
      >
        {stopping ? (
          "Stopping…"
        ) : (
          <>
            Stop<span className="sr-only"> {command}</span>
          </>
        )}
      </Button>
    </li>
  );
}

export function ProcessesDialog({
  label,
  rows,
  more,
  sessionNumber,
  stopping,
  problem,
  onStop,
  onPort,
  onClose,
}: ProcessesDialogProps) {
  const body = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const count = rows.length;
  useEffect(() => {
    if (document.activeElement !== document.body) return;
    body.current
      ?.closest("[role='dialog']")
      ?.querySelector<HTMLElement>("[data-testid='processes-close']")
      ?.focus();
  }, [count]);
  return (
    <Dialog
      title="Running processes"
      description={`What the agents in ${visibleText(label)} started and left running.`}
      testId="processes-dialog"
      onClose={onClose}
      closable
      returnFocusTo="workspace-header"
      footer={
        <Button onClick={onClose} testId="processes-close" autoFocus>
          Done
        </Button>
      }
    >
      <div ref={body} className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <p data-testid="processes-empty" role="status" className={note}>
            {nothingRunning}
          </p>
        ) : (
          <ul aria-label="Running processes" className="flex flex-col">
            {rows.map((row, index) => (
              <Row
                key={stopKey(row)}
                row={row}
                index={index}
                now={now}
                number={sessionNumber(row.session)}
                stopping={stopping.has(stopKey(row))}
                busy={stopping.size > 0}
                onStop={() => {
                  onStop(row);
                }}
                onPort={onPort}
              />
            ))}
          </ul>
        )}
        {problem !== null && (
          <p data-testid="processes-problem" role="alert" className={note}>
            {problem}
          </p>
        )}
        {more > 0 && (
          <p data-testid="processes-more" className={note}>
            {moreSentence(more)}
          </p>
        )}
        <p data-testid="processes-note" className={note}>
          {detachedSentence}
        </p>
      </div>
    </Dialog>
  );
}

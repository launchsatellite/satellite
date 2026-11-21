import { useEffect, useRef } from "react";
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
  at: number;
  more: number;
  sessionNumber: (terminalId: string) => number | undefined;
  stopping: ReadonlySet<string>;
  onStop: (row: ProcessRow) => void;
  onPort: (url: string) => void;
  onClose: () => void;
}

const note = "text-[12px] text-dim";
const ringed =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function sessionName(number: number | undefined): string {
  return number === undefined ? "A session" : `Session ${String(number)}`;
}

function Row({
  row,
  index,
  at,
  number,
  stopping,
  onStop,
  onPort,
}: {
  row: ProcessRow;
  index: number;
  at: number;
  number: number | undefined;
  stopping: boolean;
  onStop: () => void;
  onPort: (url: string) => void;
}) {
  const testId = `process-row-${String(index)}`;
  const command = visibleText(row.command);
  const age = at - row.started;
  return (
    <li
      data-testid={testId}
      data-pid={row.pid}
      className="flex items-start gap-3 border-b border-line py-2 first:pt-0 last:border-b-0 last:pb-0"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p data-testid={`${testId}-command`} className="font-mono text-[12px] break-all text-fg">
          {command}
          {row.cut ? "…" : ""}
        </p>
        <p className={`flex flex-wrap items-center gap-x-[10px] gap-y-1 ${note}`}>
          <span data-testid={`${testId}-session`}>{sessionName(number)}</span>
          <span data-testid={`${testId}-age`}>
            <span className="sr-only">running for {ageWords(age)}</span>
            <span aria-hidden="true" className="font-pixel uppercase">
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
                <span aria-hidden="true" className="font-pixel">
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
                className={`-mx-[5px] rounded-[6px] px-[5px] font-pixel hover:bg-hover ${ringed}`}
              >
                :{port}
              </button>
            ),
          )}
        </p>
      </div>
      <Button
        variant="danger"
        size="small"
        testId={`${testId}-stop`}
        disabled={stopping}
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
  at,
  more,
  sessionNumber,
  stopping,
  onStop,
  onPort,
  onClose,
}: ProcessesDialogProps) {
  const body = useRef<HTMLDivElement>(null);
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
                at={at}
                number={sessionNumber(row.session)}
                stopping={stopping.has(stopKey(row))}
                onStop={() => {
                  onStop(row);
                }}
                onPort={onPort}
              />
            ))}
          </ul>
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

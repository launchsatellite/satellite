import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ProcessRow } from "../../shared/bridge-contract.ts";
import { visibleText } from "../../shared/visible-text.ts";
import { Button } from "../ui/button.tsx";
import { Tooltip } from "../ui/tooltip.tsx";
import { stopKey } from "./use-processes.ts";
import {
  ageReadout,
  ageWords,
  detachedSentence,
  moreSentence,
  nothingRunning,
  portLabel,
} from "./process-words.ts";

interface ProcessesPopoverProps {
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
const keptOpenBy = "[role='dialog'], [role='status'], [data-testid='header-processes']";
const separatorEnd = /(?<=[^\s/\\][/\\])(?=[^/\\])/;
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
        <Tooltip text={shown}>
          <p
            data-testid={`${testId}-command`}
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
        </Tooltip>
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
              <Tooltip key={port} text={portLabel(port, false)}>
                <span data-testid={`${testId}-port-${String(port)}`} data-link="false">
                  <span className="sr-only">{portLabel(port, false)}</span>
                  <span aria-hidden="true" className="font-pixel text-dim">
                    :{port}
                  </span>
                </span>
              </Tooltip>
            ) : (
              <Button
                key={port}
                variant="link"
                testId={`${testId}-port-${String(port)}`}
                data-link="true"
                label={portLabel(port, true)}
                tooltip={portLabel(port, true)}
                onClick={() => {
                  onPort(url);
                }}
                className="font-pixel"
              >
                :{port}
              </Button>
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

export function ProcessesPopover({
  label,
  rows,
  more,
  sessionNumber,
  stopping,
  problem,
  onStop,
  onPort,
  onClose,
}: ProcessesPopoverProps) {
  const panel = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  useLayoutEffect(() => {
    const element = panel.current;
    if (element === null) return;
    const opener = document.activeElement;
    element.querySelector<HTMLElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (element.contains(event.target) || event.target.closest(keptOpenBy) !== null) return;
      onClose();
    };
    const press = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !element.contains(document.activeElement)) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("pointerdown", outside, { capture: true });
    element.addEventListener("keydown", press);
    return () => {
      window.removeEventListener("pointerdown", outside, { capture: true });
      element.removeEventListener("keydown", press);
      requestAnimationFrame(() => {
        if (document.activeElement !== document.body) return;
        if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
        else document.querySelector<HTMLElement>("[data-testid='workspace-header']")?.focus();
      });
    };
  }, [onClose]);
  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="false"
      aria-label="Running processes"
      aria-description={`What the agents in ${visibleText(label)} started and left running.`}
      data-testid="processes-popover"
      className="absolute top-12 right-2 z-30 flex max-h-[calc(100%-56px)] w-[min(420px,calc(100%-16px))] flex-col gap-3 overflow-y-auto rounded-[10px] border border-line bg-raised p-3 shadow-raised"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold">Running processes</h2>
        <Button variant="ghost" size="small" onClick={onClose} testId="processes-close">
          Done
        </Button>
      </div>
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
  );
}

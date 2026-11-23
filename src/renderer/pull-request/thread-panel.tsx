import { useEffect, useRef } from "react";
import type { PullRequestFound, PullRequestThread } from "../../shared/bridge-contract.ts";
import { sendToClaudeCode } from "../sessions/send-to-claude-code.ts";
import { Button } from "../ui/button.tsx";
import { OpenButton, ThreadBody, ThreadHead, threadHeadControl } from "./conversation-list.tsx";
import { threadRequest } from "./pull-request-requests.ts";
import {
  noFileThreadsSentence,
  offLineHeading,
  sendLabel,
  threadsHeading,
} from "./pull-request-words.ts";
import type { ThreadMark } from "./thread-places.ts";

interface ThreadPanelProps {
  found: PullRequestFound;
  threads: readonly PullRequestThread[];
  marks: readonly ThreadMark[];
  listed: readonly number[];
  current: number | null;
  onSelect: (index: number) => void;
  onLink: (address: string) => void;
}

interface Entry {
  index: number;
  line: number | null;
}

function Entries({
  found,
  threads,
  entries,
  first,
  current,
  onSelect,
  onLink,
}: {
  found: PullRequestFound;
  threads: readonly PullRequestThread[];
  entries: readonly Entry[];
  first: number;
  current: number | null;
  onSelect: (index: number) => void;
  onLink: (address: string) => void;
}) {
  return (
    <ul className="flex flex-col">
      {entries.map(({ index, line }, at) => {
        const thread = threads[index];
        if (thread === undefined) return null;
        const id = `thread-${String(first + at)}`;
        return (
          <li
            key={index}
            data-testid={id}
            data-line={line ?? undefined}
            data-resolved={thread.resolved}
            aria-current={current === index ? "true" : undefined}
            className={`flex flex-col gap-2 border-b border-line px-3 py-3 ${current === index ? "bg-sel" : ""}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid={`${id}-select`}
                onClick={() => {
                  onSelect(index);
                }}
                className={`flex items-center ${threadHeadControl}`}
              >
                <ThreadHead thread={thread} />
              </button>
              <span className="ml-auto flex items-center gap-[6px]">
                {!thread.resolved && (
                  <Button
                    variant="secondary"
                    size="small"
                    testId={`${id}-send`}
                    onClick={() => {
                      sendToClaudeCode(threadRequest(found.number, thread.url));
                    }}
                  >
                    {sendLabel}
                  </Button>
                )}
                <OpenButton
                  testId={`${id}-open`}
                  found={found}
                  address={thread.url}
                  onLink={onLink}
                />
              </span>
            </div>
            <ThreadBody thread={thread} onLink={onLink} />
          </li>
        );
      })}
    </ul>
  );
}

export function ThreadPanel({
  found,
  threads,
  marks,
  listed,
  current,
  onSelect,
  onLink,
}: ThreadPanelProps) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current]);
  const onLines = marks.flatMap((mark) =>
    mark.threads.map((index): Entry => ({ index, line: mark.line })),
  );
  const off = listed.map((index): Entry => ({ index, line: null }));
  return (
    <section
      ref={panel}
      data-testid="thread-panel"
      aria-label={threadsHeading}
      className="flex max-h-[45%] min-h-0 flex-none flex-col overflow-y-auto border-t border-line"
    >
      <h3 className="px-3 pt-3 pb-1 font-pixel text-[11px] text-dim uppercase">{threadsHeading}</h3>
      {onLines.length + off.length === 0 && (
        <p className="px-3 pb-3 text-[12px] text-dim">{noFileThreadsSentence}</p>
      )}
      <Entries
        found={found}
        threads={threads}
        entries={onLines}
        first={0}
        current={current}
        onSelect={onSelect}
        onLink={onLink}
      />
      {off.length > 0 && (
        <>
          {onLines.length > 0 && (
            <h4 className="px-3 pt-3 pb-1 font-pixel text-[11px] text-dim uppercase">
              {offLineHeading}
            </h4>
          )}
          <Entries
            found={found}
            threads={threads}
            entries={off}
            first={onLines.length}
            current={current}
            onSelect={onSelect}
            onLink={onLink}
          />
        </>
      )}
    </section>
  );
}

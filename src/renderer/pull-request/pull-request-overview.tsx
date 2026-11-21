import type { ReactNode } from "react";
import type { PullRequestFound } from "../../shared/bridge-contract.ts";
import { visibleText } from "../../shared/visible-text.ts";
import { conflictRequest } from "../changes/prompt-requests.ts";
import { sendToClaudeCode } from "../sessions/send-to-claude-code.ts";
import { Button } from "../ui/button.tsx";
import { StatusPixel, type PixelState } from "../ui/status-pixel.tsx";
import { MarkdownText } from "./markdown-text.tsx";
import { blocks, bodyCutSentence, emptyBodySentence } from "./pull-request-words.ts";

const rowPixels: Record<string, PixelState> = {
  conflicts: "needs-you",
  changes: "needs-you",
  failed: "needs-you",
  running: "working",
  clear: "ready",
  merged: "done",
};

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-b border-line px-4 py-3 last:border-b-0">
      <h3 className="text-[10px] font-semibold tracking-[0.12em] text-dim uppercase">{label}</h3>
      {children}
    </section>
  );
}

export function PullRequestOverview({
  found,
  onLink,
}: {
  found: PullRequestFound;
  onLink: (address: string) => void;
}) {
  return (
    <div data-testid="pull-request-overview" className="flex flex-col">
      <Section label="Merge">
        <ul data-testid="pull-request-blocks" className="flex flex-col gap-1">
          {blocks(found).map((row, index) => (
            <li
              key={row.key}
              data-testid={`pull-request-block-${String(index)}`}
              className="flex min-h-6 flex-wrap items-center gap-x-[9px] gap-y-1 text-[13px] text-fg"
            >
              <StatusPixel state={rowPixels[row.key] ?? "idle"} size={6} />
              <span className="min-w-0 break-words">{row.sentence}</span>
              {row.key === "conflicts" && (
                <Button
                  variant="secondary"
                  size="small"
                  testId="pull-request-conflict-send"
                  onClick={() => {
                    sendToClaudeCode(conflictRequest(found.base));
                  }}
                >
                  Send to Claude Code
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Section>
      <Section label="Description">
        {found.body.trim() === "" ? (
          <p className="text-[13px] text-dim">{emptyBodySentence}</p>
        ) : (
          <div
            data-testid="pull-request-body"
            className="min-w-0 text-[13px] leading-[20px] break-words text-fg2 [&>:first-child]:mt-0"
          >
            <MarkdownText text={found.body} onLink={onLink} />
          </div>
        )}
        {found.bodyCut && <p className="text-[12px] text-dim">{bodyCutSentence}</p>}
      </Section>
      <Section label={`Commits ${String(found.commits.length + found.moreCommits)}`}>
        <ul data-testid="pull-request-commits" className="flex flex-col">
          {found.commits.map((commit, index) => (
            <li
              key={`${commit.oid}-${String(index)}`}
              data-testid={`pull-request-commit-${String(index)}`}
              className="flex h-7 min-w-0 items-center gap-[10px] text-[13px]"
            >
              <span className="flex-none font-mono text-[12px] text-dim">{commit.oid}</span>
              <span className="min-w-0 truncate text-fg2">
                {commit.headline === "" ? "No message" : visibleText(commit.headline)}
              </span>
            </li>
          ))}
        </ul>
        {found.moreCommits > 0 && (
          <p className="text-[12px] text-dim">{String(found.moreCommits)} more on GitHub.</p>
        )}
      </Section>
    </div>
  );
}

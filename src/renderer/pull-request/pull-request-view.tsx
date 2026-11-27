import type { ReactNode } from "react";
import type { PullRequestFound } from "../../shared/bridge-contract.ts";
import { visibleText } from "../../shared/visible-text.ts";
import { Button } from "../ui/button.tsx";
import { StatusPixel } from "../ui/status-pixel.tsx";
import { Tab, Tabs } from "../ui/tabs.tsx";
import { VisibleName } from "../ui/visible-name.tsx";
import { sendToClaudeCode } from "../sessions/send-to-claude-code.ts";
import { centrePanelId, centreTabId } from "../window/centre-tabs.tsx";
import { foundOf, type PullRequestEntry } from "./use-pull-requests.ts";
import { Sentence } from "./pull-request-sentence.tsx";
import { openRequest } from "./pull-request-requests.ts";
import {
  absentSentence,
  checksSummary,
  loadingSentence,
  readoutPixel,
  stateWord,
  troubleSentence,
  untitled,
} from "./pull-request-words.ts";

export type PullRequestSection = "overview" | "checks" | "conversation" | "files";

interface PullRequestViewProps {
  entry: PullRequestEntry | undefined;
  section: PullRequestSection;
  onSection: (section: PullRequestSection) => void;
  onLink: (address: string) => void;
  children: ReactNode;
}

const sections: readonly { value: PullRequestSection; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "checks", label: "Checks" },
  { value: "conversation", label: "Conversation" },
  { value: "files", label: "Files" },
];
const sectionPanelId = "pull-request-section-panel";

function sectionTabId(section: PullRequestSection): string {
  return `pull-request-section-${section}`;
}

function isHttps(address: string): boolean {
  return URL.parse(address)?.protocol === "https:";
}

function Sections({
  value,
  onChange,
}: {
  value: PullRequestSection;
  onChange: (section: PullRequestSection) => void;
}) {
  return (
    <Tabs
      label="Pull request sections"
      value={value}
      onChange={(next) => {
        const section = sections.find((candidate) => candidate.value === next);
        if (section !== undefined) onChange(section.value);
      }}
      testId="pull-request-sections"
      activateOnFocus
      className="h-9 flex-none border-b border-line px-3"
    >
      {sections.map((section) => (
        <Tab
          key={section.value}
          value={section.value}
          id={sectionTabId(section.value)}
          panel={sectionPanelId}
          testId={sectionTabId(section.value)}
        >
          {section.label}
        </Tab>
      ))}
    </Tabs>
  );
}

function Header({ found }: { found: PullRequestFound }) {
  const title = found.title === "" ? untitled : visibleText(found.title);
  return (
    <div className="flex flex-none flex-col gap-[6px] px-4 pt-3 pb-3">
      <h2
        data-testid="pull-request-title"
        className="text-[15px] leading-5 font-semibold break-words text-fg"
      >
        {title}
      </h2>
      <div className="flex min-w-0 flex-wrap items-center gap-x-[10px] gap-y-1 text-[12px] text-dim">
        <span className="flex items-center gap-[7px]">
          <StatusPixel state={readoutPixel(found)} size={6} />
          <span className="font-pixel text-[12px] uppercase">#{found.number}</span>
          <span data-testid="pull-request-state" className="text-fg2">
            {stateWord(found.state)}
          </span>
        </span>
        <span>{checksSummary(found.counts)}</span>
        {found.head !== null && found.base !== null && (
          <span
            data-testid="pull-request-branches"
            dir="ltr"
            className="min-w-0 truncate font-mono [unicode-bidi:isolate]"
          >
            <VisibleName text={found.head} /> into <VisibleName text={found.base} />
          </span>
        )}
      </div>
    </div>
  );
}

export function PullRequestView({
  entry,
  section,
  onSection,
  onLink,
  children,
}: PullRequestViewProps) {
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
    if (found !== null) {
      return (
        <>
          <Header found={found} />
          <Sections value={section} onChange={onSection} />
          <div
            role="tabpanel"
            id={sectionPanelId}
            aria-labelledby={sectionTabId(section)}
            tabIndex={0}
            className={`min-h-0 flex-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${section === "files" ? "overflow-hidden" : "overflow-y-auto"}`}
          >
            {children}
          </div>
        </>
      );
    }
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
              Send to Claude Code
            </Button>
          )}
        </Sentence>
      );
    }
    return null;
  };
  return (
    <div data-testid="pull-request" data-state={state} className="flex min-h-0 flex-1 flex-col">
      {found !== null && isHttps(found.url) && (
        <div className="flex min-h-10 flex-none items-center justify-end border-b border-line bg-side pr-2 pl-4">
          <Button
            variant="secondary"
            size="small"
            testId="pull-request-open"
            onClick={() => {
              onLink(found.url);
            }}
          >
            Open on GitHub
          </Button>
        </div>
      )}
      {trouble !== null && (
        <p
          data-testid="pull-request-stale"
          role="status"
          className="flex-none border-b border-line bg-side px-4 py-2 text-[12px] text-fg2"
        >
          {troubleSentence(trouble)}
        </p>
      )}
      <div
        role="tabpanel"
        id={centrePanelId("pull-request")}
        aria-labelledby={centreTabId("pull-request")}
        className="flex min-h-0 flex-1 flex-col"
      >
        {body()}
      </div>
    </div>
  );
}

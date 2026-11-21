import type { KeyboardEvent, ReactNode } from "react";
import type { PullRequestFound } from "../../shared/bridge-contract.ts";
import { visibleText } from "../../shared/visible-text.ts";
import { Button } from "../ui/button.tsx";
import { StatusPixel } from "../ui/status-pixel.tsx";
import { VisibleName } from "../ui/visible-name.tsx";
import { sendToClaudeCode } from "../sessions/send-to-claude-code.ts";
import { CentreTabs, centrePanelId, centreTabId, type CentreView } from "../window/centre-tabs.tsx";
import { foundOf, type PullRequestEntry } from "./use-pull-requests.ts";
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

export type PullRequestSection = "overview" | "checks" | "conversation";

interface PullRequestViewProps {
  entry: PullRequestEntry | undefined;
  pullRequest: number | null;
  section: PullRequestSection;
  onSection: (section: PullRequestSection) => void;
  onCentre: (view: CentreView) => void;
  onLink: (address: string) => void;
  children: ReactNode;
}

const sections: readonly { value: PullRequestSection; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "checks", label: "Checks" },
  { value: "conversation", label: "Conversation" },
];
const sectionPanelId = "pull-request-section-panel";

function sectionTabId(section: PullRequestSection): string {
  return `pull-request-section-${section}`;
}

function isHttps(address: string): boolean {
  return URL.parse(address)?.protocol === "https:";
}

function Sentence({
  testId,
  text,
  children,
}: {
  testId: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
      <p
        data-testid={testId}
        role="status"
        className="max-w-[360px] text-center text-[13px] text-fg2"
      >
        {text}
      </p>
      {children}
    </div>
  );
}

function Sections({
  value,
  onChange,
}: {
  value: PullRequestSection;
  onChange: (section: PullRequestSection) => void;
}) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = sections.findIndex((section) => section.value === value);
    const targets: Record<string, number | undefined> = {
      ArrowRight: (at + 1) % sections.length,
      ArrowLeft: (at - 1 + sections.length) % sections.length,
      Home: 0,
      End: sections.length - 1,
    };
    const target = sections[targets[event.key] ?? -1];
    if (target === undefined) return;
    event.preventDefault();
    onChange(target.value);
    requestAnimationFrame(() => {
      document.getElementById(sectionTabId(target.value))?.focus();
    });
  };
  return (
    <div
      role="tablist"
      aria-label="Pull request sections"
      data-testid="pull-request-sections"
      onKeyDown={move}
      className="flex h-9 flex-none items-center gap-0.5 border-b border-line px-3"
    >
      {sections.map((section) => {
        const selected = section.value === value;
        return (
          <button
            key={section.value}
            type="button"
            role="tab"
            id={sectionTabId(section.value)}
            aria-selected={selected}
            aria-controls={sectionPanelId}
            tabIndex={selected ? 0 : -1}
            data-testid={sectionTabId(section.value)}
            onClick={() => {
              onChange(section.value);
            }}
            className={`flex h-[26px] items-center rounded-[6px] px-[9px] text-[12px] font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${selected ? "bg-sel text-fg" : "text-dim hover:bg-hover"}`}
          >
            {section.label}
          </button>
        );
      })}
    </div>
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
  pullRequest,
  section,
  onSection,
  onCentre,
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
            className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
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
        </Sentence>
      );
    }
    return null;
  };
  return (
    <div data-testid="pull-request" data-state={state} className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-10 flex-none flex-wrap items-center gap-x-2 border-b border-line bg-side px-2">
        <CentreTabs value="pull-request" pullRequest={pullRequest} onChange={onCentre} />
        {found !== null && isHttps(found.url) && (
          <div className="ml-auto flex items-center py-[5px]">
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
      </div>
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

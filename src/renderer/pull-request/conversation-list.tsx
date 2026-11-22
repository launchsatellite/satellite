import { useState, type ReactNode } from "react";
import type { PullRequestFound, PullRequestThread } from "../../shared/bridge-contract.ts";
import { visibleText } from "../../shared/visible-text.ts";
import { sendToClaudeCode } from "../sessions/send-to-claude-code.ts";
import { Button } from "../ui/button.tsx";
import { VisibleName } from "../ui/visible-name.tsx";
import { MarkdownText } from "./markdown-text.tsx";
import { threadRequest } from "./pull-request-requests.ts";
import {
  bodyCutSentence,
  conversationTroubleSentence,
  decisionSentence,
  hiddenCommentSentence,
  loadingSentence,
  moreSentence,
  noConversationSentence,
  openLabel,
  reviewWord,
  sendLabel,
  showMoreLabel,
  someone,
  outsideWord,
  threadBadges,
} from "./pull-request-words.ts";
import { conversationItems, drawnBy, drawnCount, type ConversationItem } from "./thread-order.ts";

type Spoken = PullRequestThread["comments"][number];

const drawnPage = 40_000;

function Author({ spoken }: { spoken: Spoken }) {
  const { author: name, at, outside } = spoken;
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[12px]">
      <span dir="ltr" className="min-w-0 truncate font-medium text-fg [unicode-bidi:isolate]">
        {name === null || name === "" ? someone : visibleText(name)}
      </span>
      {outside && <span className="text-dim">{outsideWord}</span>}
      {at !== null && <time className="text-dim">{at.slice(0, 10)}</time>}
    </span>
  );
}

function Said({ spoken, onLink }: { spoken: Spoken; onLink: (address: string) => void }) {
  if (spoken.hidden)
    return <p className="text-[12px] text-dim">{hiddenCommentSentence(spoken.hiddenReason)}</p>;
  return (
    <>
      {spoken.body.trim() !== "" && (
        <div className="min-w-0 text-[13px] leading-[20px] break-words text-fg2 [&>:first-child]:mt-0">
          <MarkdownText text={spoken.body} onLink={onLink} />
        </div>
      )}
      {spoken.bodyCut && <p className="text-[12px] text-dim">{bodyCutSentence}</p>}
    </>
  );
}

export function OpenButton({
  testId,
  found,
  address,
  onLink,
}: {
  testId: string;
  found: PullRequestFound;
  address: string | null;
  onLink: (address: string) => void;
}) {
  if (address === null) return null;
  return (
    <Button
      variant="ghost"
      size="small"
      testId={testId}
      onClick={() => {
        onLink(address);
      }}
    >
      {openLabel(found.host, address, "Open link")}
    </Button>
  );
}

export function ThreadBody({
  thread,
  onLink,
}: {
  thread: PullRequestThread;
  onLink: (address: string) => void;
}) {
  const [budget, setBudget] = useState(drawnPage);
  const drawn = drawnBy(
    thread.comments.map(({ body }) => body.length),
    budget,
  );
  return (
    <div className="flex flex-col gap-3">
      {thread.comments.slice(0, drawn).map((spoken, at) => (
        <div key={at} className="flex flex-col gap-1">
          <Author spoken={spoken} />
          <Said spoken={spoken} onLink={onLink} />
        </div>
      ))}
      {drawn < thread.comments.length && (
        <div>
          <Button
            variant="secondary"
            size="small"
            testId="pull-request-thread-more"
            onClick={() => {
              setBudget((kept) => kept + drawnPage);
            }}
          >
            {showMoreLabel(thread.comments.length - drawn)}
          </Button>
        </div>
      )}
      {thread.moreComments > 0 && (
        <p className="text-[12px] text-dim">{moreSentence(thread.moreComments)}</p>
      )}
    </div>
  );
}

function Frame({
  id,
  kind,
  resolved,
  children,
}: {
  id: string;
  kind: ConversationItem["kind"];
  resolved?: boolean;
  children: ReactNode;
}) {
  return (
    <li
      data-testid={id}
      data-kind={kind}
      data-resolved={resolved}
      className="flex flex-col gap-2 border-b border-line px-4 py-3 last:border-b-0"
    >
      {children}
    </li>
  );
}

export function ThreadHead({ thread }: { thread: PullRequestThread }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-[9px] gap-y-1 text-[12px]">
      {thread.path !== null && (
        <span dir="ltr" className="min-w-0 truncate font-mono text-fg [unicode-bidi:isolate]">
          <VisibleName text={thread.path} />
          {thread.line !== null && `:${String(thread.line)}`}
        </span>
      )}
      {threadBadges(thread).map((badge) => (
        <span key={badge} className="font-pixel text-[11px] text-fg2 uppercase">
          {badge}
        </span>
      ))}
    </span>
  );
}

function Item({
  index,
  item,
  found,
  onLink,
}: {
  index: number;
  item: ConversationItem;
  found: PullRequestFound;
  onLink: (address: string) => void;
}) {
  const id = `pull-request-item-${String(index)}`;
  if (item.kind === "thread") {
    const { thread } = item;
    const actions = (
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
        <OpenButton testId={`${id}-open`} found={found} address={thread.url} onLink={onLink} />
      </span>
    );
    if (thread.resolved) {
      return (
        <Frame id={id} kind="thread" resolved>
          <details className="group flex flex-col gap-2">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              <ThreadHead thread={thread} />
              <span className="text-[12px] text-dim group-open:hidden">Show thread</span>
              <span className="hidden text-[12px] text-dim group-open:inline">Hide thread</span>
              {actions}
            </summary>
            <div className="pt-2">
              <ThreadBody thread={thread} onLink={onLink} />
            </div>
          </details>
        </Frame>
      );
    }
    return (
      <Frame id={id} kind="thread" resolved={false}>
        <div className="flex flex-wrap items-center gap-2">
          <ThreadHead thread={thread} />
          {actions}
        </div>
        <ThreadBody thread={thread} onLink={onLink} />
      </Frame>
    );
  }
  const spoken = item.kind === "review" ? item.review : item.comment;
  return (
    <Frame id={id} kind={item.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <Author spoken={spoken} />
        {item.kind === "review" && (
          <span className="font-pixel text-[11px] text-fg2 uppercase">
            {reviewWord(item.review.state)}
          </span>
        )}
        <span className="ml-auto flex items-center">
          <OpenButton testId={`${id}-open`} found={found} address={spoken.url} onLink={onLink} />
        </span>
      </div>
      <Said spoken={spoken} onLink={onLink} />
    </Frame>
  );
}

function keysOf(items: readonly ConversationItem[]): string[] {
  const addresses = items.map((item) => {
    if (item.kind === "thread") return item.thread.url ?? item.thread.comments[0]?.url ?? null;
    return (item.kind === "review" ? item.review : item.comment).url;
  });
  return addresses.map((address, index) =>
    address !== null && addresses.indexOf(address) === index
      ? address
      : `${items[index]?.kind ?? "item"}-${String(index)}`,
  );
}

export function ConversationList({
  found,
  onLink,
}: {
  found: PullRequestFound;
  onLink: (address: string) => void;
}) {
  const { detail } = found;
  const [budget, setBudget] = useState(drawnPage);
  if (detail === null) {
    return (
      <div
        data-testid="pull-request-conversation"
        role="status"
        className="flex flex-col gap-1 px-4 py-3 text-[13px] text-dim"
      >
        {decisionSentence(found.review) !== null && (
          <p data-testid="pull-request-conversation-decision" className="text-fg2">
            {decisionSentence(found.review)}
          </p>
        )}
        <p>{loadingSentence}</p>
      </div>
    );
  }
  if (detail.kind === "unavailable") {
    return (
      <p
        data-testid="pull-request-conversation"
        role="status"
        className="px-4 py-3 text-[13px] text-fg2"
      >
        {conversationTroubleSentence}
      </p>
    );
  }
  const items = conversationItems(detail);
  const keys = keysOf(items);
  const drawn = drawnCount(items, budget);
  const more = detail.moreThreads + detail.moreReviews + detail.moreComments;
  return (
    <div
      data-testid="pull-request-conversation"
      tabIndex={-1}
      className="flex flex-col outline-none"
    >
      {items.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-dim">{noConversationSentence}</p>
      ) : (
        <ul className="flex flex-col">
          {items.slice(0, drawn).map((item, index) => (
            <Item key={keys[index]} index={index} item={item} found={found} onLink={onLink} />
          ))}
        </ul>
      )}
      {drawn < items.length && (
        <div className="px-4 py-3">
          <Button
            variant="secondary"
            size="small"
            testId="pull-request-conversation-more"
            onClick={() => {
              setBudget((kept) => kept + drawnPage);
            }}
          >
            {showMoreLabel(items.length - drawn)}
          </Button>
        </div>
      )}
      {more > 0 && <p className="px-4 py-2 text-[12px] text-dim">{moreSentence(more)}</p>}
    </div>
  );
}

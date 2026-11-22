import { useCallback, useEffect, useState } from "react";
import type { PullRequestFound } from "../../shared/bridge-contract.ts";
import type { Notify } from "../ui/toast.tsx";
import type { ThreadTarget } from "./pull-request-files.tsx";
import type { PullRequestSection } from "./pull-request-view.tsx";
import { noUnresolvedSentence } from "./pull-request-words.ts";
import { threadOrder } from "./thread-order.ts";

interface Placed extends ThreadTarget {
  place: string;
}

interface ThreadJumpInput {
  place: string | null;
  shown: boolean;
  found: PullRequestFound | null;
  notify: Notify;
  onSection: (section: PullRequestSection) => void;
}

export function useThreadJump({ place, shown, found, notify, onSection }: ThreadJumpInput) {
  const [target, setTarget] = useState<Placed | null>(null);
  const [jumpFrom, setJumpFrom] = useState<string | null>(null);
  const [noThreads, setNoThreads] = useState(0);
  const [conversationFocus, setConversationFocus] = useState(0);
  const detailRead = found?.detail?.kind === "read" ? found.detail : null;
  const jumpDone = found?.detail?.kind === "unavailable" || detailRead !== null;
  if (jumpFrom !== null && (jumpFrom !== place || !shown)) setJumpFrom(null);
  if (jumpFrom !== null && jumpFrom === place && jumpDone) {
    setJumpFrom(null);
    const order = detailRead === null ? [] : threadOrder(detailRead);
    const now = target?.place === place ? target : null;
    const next = order[((now === null ? -1 : order.indexOf(now.index)) + 1) % order.length];
    if (next === undefined) {
      setNoThreads((count) => count + 1);
    } else {
      setTarget({ place: jumpFrom, index: next, seq: (now?.seq ?? 0) + 1 });
      if (detailRead?.threads[next]?.path === null) {
        onSection("conversation");
        setConversationFocus((count) => count + 1);
      }
    }
  }
  useEffect(() => {
    if (noThreads === 0) return;
    const id = setTimeout(() => {
      notify(noUnresolvedSentence, "error");
    }, 0);
    return () => {
      clearTimeout(id);
    };
  }, [noThreads, notify]);
  useEffect(() => {
    if (conversationFocus === 0) return;
    const id = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-testid="pull-request-conversation"]')?.focus();
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, [conversationFocus]);
  const select = useCallback(
    (index: number) => {
      if (place === null) return;
      setTarget((kept) => ({ place, index, seq: (kept?.seq ?? 0) + 1 }));
    },
    [place],
  );
  const jump = useCallback(() => {
    setJumpFrom(place);
  }, [place]);
  return { target: target?.place === place ? target : null, select, jump };
}

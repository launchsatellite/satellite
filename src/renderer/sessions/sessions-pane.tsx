import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceRef } from "../../shared/bridge-contract.ts";
import { promptText } from "../../shared/prompt-text.ts";
import { invoke } from "../bridge/bridge-client.ts";
import { TerminalView } from "../terminal/terminal-view.tsx";
import { Button } from "../ui/button.tsx";
import type { Notify } from "../ui/toast.tsx";
import {
  leavesFocusAlone,
  sendToClaudeCodeEvent,
  sentText,
  type PromptTarget,
} from "./send-to-claude-code.ts";
import { SessionTabs, sessionPanelId, sessionTabId } from "./session-tabs.tsx";
import type { Sessions } from "./use-sessions.ts";

interface SessionsPaneProps {
  sessions: Sessions;
  selected: WorkspaceRef | null;
  onAskLink: (address: string) => void;
  notify: Notify;
}

const noSession = "Start a Claude Code session in this workspace first.";
const answerFirst = "Answer Claude Code first, then send this again.";
const notReady =
  "Satellite can send here once Claude Code has taken your first request and reported it. Type this one yourself.";

function EmptyWorkspace({
  workspace,
  onOpen,
}: {
  workspace: WorkspaceRef;
  onOpen: (resume: boolean) => void;
}) {
  const { projectId, workspace: key } = workspace;
  const [resumable, setResumable] = useState<boolean>();
  const actions = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let current = true;
    void invoke("sessions.resumable", { workspace: { projectId, workspace: key } }).then(
      (result) => {
        if (current) setResumable(result.ok && result.value.resumable);
      },
    );
    return () => {
      current = false;
    };
  }, [projectId, key]);
  useEffect(() => {
    if (resumable === undefined) return;
    const focused = document.activeElement;
    if (focused !== null && focused !== document.body && focused.isConnected) return;
    actions.current?.querySelector("button")?.focus();
  }, [resumable]);
  if (resumable === undefined) return <div className="flex-1" />;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <p role="status" data-testid="sessions-empty" className="text-[13px] text-fg2">
        {resumable
          ? "Your last session here can pick up where it left off."
          : "No Claude Code session here yet."}
      </p>
      <div ref={actions} className="flex flex-wrap items-center justify-center gap-[10px]">
        {resumable ? (
          <>
            <Button
              testId="resume-session"
              onClick={() => {
                onOpen(true);
              }}
            >
              Resume session
            </Button>
            <Button
              variant="secondary"
              testId="start-claude"
              onClick={() => {
                onOpen(false);
              }}
            >
              Start a new session
            </Button>
          </>
        ) : (
          <Button
            testId="start-claude"
            onClick={() => {
              onOpen(false);
            }}
          >
            Start Claude Code
          </Button>
        )}
      </div>
    </div>
  );
}

export function SessionsPane({ sessions, selected, onAskLink, notify }: SessionsPaneProps) {
  const tabs = selected === null ? [] : sessions.tabsOf(selected);
  const active = selected === null ? undefined : sessions.activeOf(selected);
  const shownTab = tabs.find((tab) => tab.key === active);
  const targets = useRef(new Map<string, PromptTarget>());
  const pane = useRef<HTMLDivElement>(null);
  const latest = useRef({ shownTab, notify });
  useEffect(() => {
    latest.current = { shownTab, notify };
  }, [shownTab, notify]);
  useEffect(() => {
    const receive = (event: Event) => {
      const raw = sentText(event);
      if (raw === undefined) return;
      const text = promptText(raw);
      if (text === "") return;
      const { shownTab: tab, notify: tell } = latest.current;
      const target = tab === undefined ? undefined : targets.current.get(tab.terminalId);
      if (tab === undefined || target === undefined) {
        tell(noSession, "error");
        return;
      }
      if (!tab.ready) {
        tell(notReady, "error");
        return;
      }
      if (tab.status === "needs-you") {
        tell(answerFirst, "error");
        return;
      }
      target.paste(text);
      setTimeout(() => {
        if (leavesFocusAlone(document.activeElement, pane.current)) return;
        targets.current.get(tab.terminalId)?.focus();
      });
    };
    window.addEventListener(sendToClaudeCodeEvent, receive);
    return () => {
      window.removeEventListener(sendToClaudeCodeEvent, receive);
    };
  }, []);
  const offerTarget = useCallback((id: string, target: PromptTarget) => {
    targets.current.set(id, target);
    return () => {
      if (targets.current.get(id) === target) targets.current.delete(id);
    };
  }, []);
  const top = () => {
    if (selected === null) {
      return (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <p data-testid="sessions-empty" className="text-[13px] text-fg2">
            Pick a workspace to start Claude Code there.
          </p>
        </div>
      );
    }
    if (tabs.length === 0) {
      return (
        <EmptyWorkspace
          key={`${selected.projectId}/${selected.workspace}`}
          workspace={selected}
          onOpen={(resume) => {
            sessions.open(selected, resume);
          }}
        />
      );
    }
    return (
      <SessionTabs
        tabs={tabs}
        active={active}
        onActivate={sessions.activate}
        onClose={sessions.close}
      />
    );
  };
  return (
    <div ref={pane} className="flex h-full min-h-0 flex-col">
      {top()}
      <div hidden={tabs.length === 0} className="min-h-0 flex-1">
        {sessions.all.map((tab) => {
          const shown = tab.key === active;
          return (
            <div
              key={tab.key}
              role="tabpanel"
              id={sessionPanelId(tab.key)}
              aria-labelledby={sessionTabId(tab.key)}
              hidden={!shown}
              className="h-full"
            >
              <TerminalView
                key={tab.terminalId}
                terminalId={tab.terminalId}
                workspace={tab.workspace}
                resume={tab.resume}
                shown={shown}
                onRestart={() => {
                  sessions.restart(tab.key);
                }}
                onAskLink={onAskLink}
                onPromptTarget={offerTarget}
                notify={notify}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { InstallFix, WorkspaceRef } from "../../shared/bridge-contract.ts";
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
  "Satellite sends here only after Claude Code reports your first request. Type this one yourself.";
const missingLeads: Record<InstallFix["kind"], string> = {
  command: "Run this in a terminal, then start Claude Code again.",
  address: "Follow the steps at this address, then start Claude Code again.",
};

function InstallStep() {
  const [fix, setFix] = useState<InstallFix>();
  useEffect(() => {
    let current = true;
    void invoke("tools.check", {}).then((check) => {
      if (current && check.ok && check.value.claude.state === "missing") {
        setFix(check.value.claude.fix);
      }
    });
    return () => {
      current = false;
    };
  }, []);
  if (fix === undefined) return null;
  return (
    <div className="flex flex-col items-center gap-1">
      <p className="text-[12.5px] text-fg2">{missingLeads[fix.kind]}</p>
      <code
        data-testid="claude-missing-fix"
        className="rounded-[6px] border border-ctl bg-side px-2 py-1 font-mono text-[12px] break-words text-fg select-all"
      >
        {fix.text}
      </code>
    </div>
  );
}

function EmptyWorkspace({
  workspace,
  missing,
  onOpen,
}: {
  workspace: WorkspaceRef;
  missing: string | undefined;
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
        {missing ??
          (resumable
            ? "Your last session here can pick up where it left off."
            : "No Claude Code session here yet.")}
      </p>
      {missing !== undefined && <InstallStep />}
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
  const [missing, setMissing] = useState<string>();
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
          missing={missing}
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
                onStarted={() => {
                  setMissing(undefined);
                }}
                onMissing={(sentence) => {
                  setMissing(sentence);
                  if (sessions.tabsOf(tab.workspace).length > 1) notify(sentence, "error");
                  sessions.close(tab.key);
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

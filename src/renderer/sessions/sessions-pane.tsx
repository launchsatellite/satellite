import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { InstallFix, WorkspaceRef } from "../../shared/bridge-contract.ts";
import { promptText } from "../../shared/prompt-text.ts";
import { invoke } from "../bridge/bridge-client.ts";
import { TerminalView } from "../terminal/terminal-view.tsx";
import { Button } from "../ui/button.tsx";
import type { Notify } from "../ui/toast.tsx";
import { focusSessionEvent, focusedTerminal } from "./focus-session.ts";
import {
  hooksOffNote,
  leavesFocusAlone,
  sendToClaudeCodeEvent,
  sentText,
  type PromptTarget,
} from "./send-to-claude-code.ts";
import { SessionTabs, sessionPanelId, sessionTabId } from "./session-tabs.tsx";
import { tabLimit, tabLimitSentence, type Sessions } from "./use-sessions.ts";

interface SessionsPaneProps {
  sessions: Sessions;
  selected: WorkspaceRef | null;
  hasProjects: boolean;
  resumeAllowed: boolean;
  onAskLink: (address: string) => void;
  notify: Notify;
}

const noSession = "Start a Claude Code session in this workspace first.";
const answerFirst = "Answer Claude Code first, then send this again.";
const notReady =
  "Satellite sends here only after Claude Code reports your first request. Type this one yourself.";
const hooksOffSend = `${hooksOffNote} Type this one yourself.`;
const updateFix: InstallFix = {
  kind: "address",
  text: "https://code.claude.com/docs/en/setup#update-claude-code",
};
const missingLeads: Record<InstallFix["kind"] | "update", string> = {
  update: "Follow the steps at this address for the way you installed it.",
  command: "Run this in a terminal to install it.",
  address: "Follow the steps at this address to install it.",
};

function holdsTab(tabs: Sessions["all"], key: string | undefined): boolean {
  return key !== undefined && tabs.some((tab) => tab.key === key);
}

function InstallStep() {
  const [fix, setFix] = useState<InstallFix>();
  useEffect(() => {
    let current = true;
    void invoke("tools.check", {}).then((check) => {
      if (!current || !check.ok) return;
      const { claude } = check.value;
      if (claude.state === "missing") setFix(claude.fix);
      if (claude.state === "too-old") setFix(updateFix);
    });
    return () => {
      current = false;
    };
  }, []);
  if (fix === undefined) return null;
  return (
    <div className="flex w-full max-w-[360px] flex-col items-center gap-1">
      <p className="text-[12px] text-fg2">
        {missingLeads[fix === updateFix ? "update" : fix.kind]}
      </p>
      <code
        data-testid="claude-missing-fix"
        className="block w-full rounded-[6px] border border-ctl bg-side px-2 py-1 text-left font-mono text-[12px] break-words text-fg select-all"
      >
        {fix.text}
      </code>
    </div>
  );
}

function EmptyWorkspace({
  workspace,
  missing,
  atLimit,
  onOpen,
  onResumeQuietly,
}: {
  workspace: WorkspaceRef;
  missing: string | undefined;
  atLimit: boolean;
  onOpen: (resume: boolean) => boolean;
  onResumeQuietly: (() => void) | undefined;
}) {
  const { projectId, workspace: key } = workspace;
  const [resumable, setResumable] = useState<boolean>();
  const [full, setFull] = useState(false);
  const start = (resume: boolean) => {
    setFull(!onOpen(resume));
  };
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
  const resumingQuietly = resumable === true && onResumeQuietly !== undefined;
  useEffect(() => {
    if (resumingQuietly) onResumeQuietly();
  }, [resumingQuietly, onResumeQuietly]);
  useEffect(() => {
    if (resumable === undefined || resumingQuietly) return;
    const focused = document.activeElement;
    if (focused !== null && focused !== document.body && focused.isConnected) return;
    actions.current?.querySelector("button")?.focus();
  }, [resumable, resumingQuietly]);
  if (resumable === undefined || resumingQuietly) return <div className="flex-1" />;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <p
        role={missing === undefined && !(full && atLimit) ? undefined : "status"}
        data-testid="sessions-empty"
        className="text-[13px] text-fg2"
      >
        {missing ??
          (full && atLimit ? tabLimitSentence : undefined) ??
          (resumable
            ? "Your last session here can pick up where it left off."
            : "No Claude Code session here yet.")}
      </p>
      {missing !== undefined && <InstallStep />}
      <div
        ref={actions}
        data-guide="session"
        className="flex flex-wrap items-center justify-center gap-[10px]"
      >
        {resumable ? (
          <>
            <Button
              testId="resume-session"
              onClick={() => {
                start(true);
              }}
            >
              Resume session
            </Button>
            <Button
              variant="secondary"
              testId="start-claude"
              onClick={() => {
                start(false);
              }}
            >
              Start a new session
            </Button>
          </>
        ) : (
          <Button
            testId="start-claude"
            onClick={() => {
              start(false);
            }}
          >
            Start Claude Code
          </Button>
        )}
      </div>
    </div>
  );
}

export function SessionsPane({
  sessions,
  selected,
  hasProjects,
  resumeAllowed,
  onAskLink,
  notify,
}: SessionsPaneProps) {
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
        tell(tab.hooksOff ? hooksOffSend : notReady, "error");
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
  useEffect(() => {
    const receive = (event: Event) => {
      const terminalId = focusedTerminal(event);
      if (terminalId === undefined) return;
      setTimeout(() => {
        targets.current.get(terminalId)?.focus();
      });
    };
    window.addEventListener(focusSessionEvent, receive);
    return () => {
      window.removeEventListener(focusSessionEvent, receive);
    };
  }, []);
  const quietKey = useRef<string>(undefined);
  const keptFocus = useRef<Element | null>(null);
  useLayoutEffect(() => {
    if (holdsTab(sessions.all, quietKey.current)) keptFocus.current = document.activeElement;
  }, [sessions.all]);
  useEffect(() => {
    if (!holdsTab(sessions.all, quietKey.current)) return;
    quietKey.current = undefined;
    const kept = keptFocus.current;
    keptFocus.current = null;
    if (kept instanceof HTMLElement && kept !== document.body && kept.isConnected) {
      kept.focus({ preventScroll: true });
    }
  }, [sessions.all]);
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
            {hasProjects
              ? "Pick a workspace to start Claude Code there."
              : "Add a project to start Claude Code in it."}
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
          atLimit={sessions.all.length >= tabLimit}
          onOpen={(resume) => sessions.open(selected, resume)}
          onResumeQuietly={
            resumeAllowed && missing === undefined && sessions.resumesQuietly(selected)
              ? () => {
                  quietKey.current = sessions.resumeQuietly(selected) ?? quietKey.current;
                }
              : undefined
          }
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

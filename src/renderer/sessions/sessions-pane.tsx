import { useEffect, useRef, useState } from "react";
import type { WorkspaceRef } from "../../shared/bridge-contract.ts";
import { invoke } from "../bridge/bridge-client.ts";
import { TerminalView } from "../terminal/terminal-view.tsx";
import { Button } from "../ui/button.tsx";
import { SessionTabs, sessionPanelId, sessionTabId } from "./session-tabs.tsx";
import type { Sessions } from "./use-sessions.ts";

interface SessionsPaneProps {
  sessions: Sessions;
  selected: WorkspaceRef | null;
}

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

export function SessionsPane({ sessions, selected }: SessionsPaneProps) {
  const tabs = selected === null ? [] : sessions.tabsOf(selected);
  const active = selected === null ? undefined : sessions.activeOf(selected);
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
    <div className="flex h-full min-h-0 flex-col">
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
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

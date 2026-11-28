import { useEffect, useState } from "react";
import { visibleText } from "../../shared/visible-text.ts";
import { ageReadout, ageWords } from "../processes/process-words.ts";
import { chipLook } from "../ui/chip.ts";
import { rowLook, rowRing } from "../ui/row-look.ts";
import { StatusPixel } from "../ui/status-pixel.tsx";
import { withUniqueTestIds } from "../ui/unique-test-ids.ts";
import { visibleLabel } from "../ui/visible-name.tsx";
import { Page } from "../window/page.tsx";
import type { Frame } from "../window/top-row.tsx";
import { agentGroups, type AgentItem } from "./agent-list.ts";

interface AgentsPageProps {
  agents: readonly AgentItem[];
  onOpen: (agent: AgentItem) => void;
  onBack: () => void;
  frame: Frame;
  edges: { left: number; right: number };
}

function plural(count: number, one: string): string {
  return `${String(count)} ${one}${count === 1 ? "" : "s"}`;
}

function leadOf(agents: readonly AgentItem[]): string {
  if (agents.length === 0) return "No Claude Code session is open in any repo.";
  const repos = new Set(agents.map((agent) => agent.ref.projectId)).size;
  const needing = agents.filter((agent) => agent.group === "needs-you").length;
  const asking =
    needing === 0 ? "" : needing === 1 ? " 1 needs you." : ` ${String(needing)} need you.`;
  return `${plural(agents.length, "session")} in ${plural(repos, "repo")}.${asking}`;
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}

export function AgentsPage({ agents, onOpen, onBack, frame, edges }: AgentsPageProps) {
  const now = useNow();
  const rows = withUniqueTestIds(
    agents.map((agent) => ({ agent, testId: `agent-${agent.project}-${agent.testKey}` })),
  );
  return (
    <Page
      title="agents"
      lead={leadOf(agents)}
      testId="agents-page"
      back="Back"
      onBack={onBack}
      frame={frame}
      edges={edges}
      focusFirst="li button"
    >
      {agentGroups.map(({ group, title, pixel }) => {
        const listed = rows.filter((row) => row.agent.group === group);
        if (listed.length === 0) return null;
        return (
          <section key={group} aria-label={title} className="flex flex-col gap-1">
            <h3 className="flex items-center gap-2 px-2 pt-2 text-[12px] font-semibold text-dim">
              <StatusPixel state={pixel} size={6} />
              {title}
              <span className="font-pixel uppercase">{listed.length}</span>
            </h3>
            <ul className="flex flex-col">
              {listed.map(({ agent, testId }) => {
                const age = now - agent.since;
                const place =
                  agent.parent === undefined ? agent.project : `${agent.project} · ${agent.parent}`;
                return (
                  <li key={agent.key}>
                    <button
                      type="button"
                      data-testid={testId}
                      onClick={() => {
                        onOpen(agent);
                      }}
                      className={`grid h-12 w-full grid-cols-[8px_minmax(0,1fr)_minmax(0,0.8fr)_72px_64px] items-center gap-3 px-3 text-left text-[13px] ${rowLook(false)} ${rowRing}`}
                    >
                      <StatusPixel state={agent.pixel} />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-semibold text-fg">
                          {visibleLabel(agent.label)}
                        </span>
                        <span className="truncate text-[12px] text-dim">
                          {visibleText(`${place} · Session ${String(agent.session)}`)}
                        </span>
                      </span>
                      <span className="truncate text-fg2">{agent.state}</span>
                      <span>
                        <span
                          className={chipLook(agent.pullRequest === null ? "idle" : agent.pixel)}
                        >
                          {agent.pullRequest === null ? (
                            "no PR"
                          ) : (
                            <span className="font-pixel">#{agent.pullRequest}</span>
                          )}
                        </span>
                      </span>
                      <span className="text-right font-pixel text-[12px] text-dim uppercase">
                        <span className="sr-only">for {ageWords(age)}</span>
                        <span aria-hidden="true">{ageReadout(age)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </Page>
  );
}

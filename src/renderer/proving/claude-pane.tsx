import { useState } from "react";
import type { WorkspaceRef } from "../../shared/bridge-contract.ts";
import { TerminalView } from "../terminal/terminal-view.tsx";
import { Button } from "../ui/button.tsx";

export function ClaudePane({ workspace }: { workspace: WorkspaceRef | null }) {
  const [starts, setStarts] = useState(0);
  const start = () => {
    setStarts((count) => count + 1);
  };
  if (workspace === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <p data-testid="sessions-empty" className="text-[13px] text-fg2">
          Pick a workspace to start Claude Code there.
        </p>
      </div>
    );
  }
  if (starts > 0) return <TerminalView key={starts} workspace={workspace} onRestart={start} />;
  return (
    <div className="flex h-full items-center justify-center">
      <Button testId="start-claude" onClick={start}>
        Start Claude Code
      </Button>
    </div>
  );
}

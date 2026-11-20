import { useState } from "react";
import { TerminalView } from "../terminal/terminal-view.tsx";
import { Button } from "../ui/button.tsx";

export function ClaudePane() {
  const [terminalId, setTerminalId] = useState<string>();
  if (terminalId !== undefined) return <TerminalView terminalId={terminalId} />;
  return (
    <div className="flex h-full items-center justify-center">
      <Button
        testId="start-claude"
        onClick={() => {
          setTerminalId(crypto.randomUUID());
        }}
      >
        Start Claude Code
      </Button>
    </div>
  );
}

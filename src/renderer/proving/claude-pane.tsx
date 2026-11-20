import { useState } from "react";
import { TerminalView } from "../terminal/terminal-view.tsx";
import { Button } from "../ui/button.tsx";

export function ClaudePane() {
  const [terminalId, setTerminalId] = useState<string>();
  const start = () => {
    setTerminalId(crypto.randomUUID());
  };
  if (terminalId !== undefined) {
    return <TerminalView key={terminalId} terminalId={terminalId} onRestart={start} />;
  }
  return (
    <div className="flex h-full items-center justify-center">
      <Button testId="start-claude" onClick={start}>
        Start Claude Code
      </Button>
    </div>
  );
}

import { useState } from "react";
import { TerminalView } from "../terminal/terminal-view.tsx";
import { Button } from "../ui/button.tsx";

export function ClaudePane() {
  const [starts, setStarts] = useState(0);
  const start = () => {
    setStarts((count) => count + 1);
  };
  if (starts > 0) return <TerminalView key={starts} onRestart={start} />;
  return (
    <div className="flex h-full items-center justify-center">
      <Button testId="start-claude" onClick={start}>
        Start Claude Code
      </Button>
    </div>
  );
}

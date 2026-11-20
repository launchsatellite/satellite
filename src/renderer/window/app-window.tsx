import { ClaudePane } from "../proving/claude-pane.tsx";
import { SampleDiff } from "../proving/sample-diff.tsx";
import { ToolReadout } from "../proving/tool-readout.tsx";

export function AppWindow() {
  return (
    <div
      data-testid="app-window"
      className="grid h-full grid-cols-[260px_minmax(0,1fr)_520px] bg-bg text-fg"
    >
      <section
        data-testid="column-projects"
        aria-label="Projects"
        className="flex flex-col justify-end border-r border-line bg-side p-4"
      >
        <ToolReadout />
      </section>
      <section
        data-testid="column-repository"
        aria-label="Repository"
        className="min-h-0 border-r border-line"
      >
        <SampleDiff />
      </section>
      <section data-testid="column-sessions" aria-label="Sessions" className="min-h-0">
        <ClaudePane />
      </section>
    </div>
  );
}

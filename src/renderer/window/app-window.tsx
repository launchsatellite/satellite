export function AppWindow() {
  return (
    <div
      data-testid="app-window"
      className="grid h-full grid-cols-[260px_minmax(0,1fr)_520px] bg-bg text-fg"
    >
      <section
        data-testid="column-projects"
        aria-label="Projects"
        className="border-r border-line bg-side"
      />
      <section
        data-testid="column-repository"
        aria-label="Repository"
        className="border-r border-line"
      />
      <section data-testid="column-sessions" aria-label="Sessions" />
    </div>
  );
}

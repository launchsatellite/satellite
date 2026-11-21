export const centreTabId = "centre-tab-changes";
export const centrePanelId = "centre-panel-changes";

export function CentreTabs() {
  return (
    <div
      role="tablist"
      aria-label="Workspace views"
      data-testid="centre-tabs"
      className="flex h-10 min-w-0 items-center gap-0.5"
    >
      <button
        type="button"
        role="tab"
        id={centreTabId}
        aria-selected="true"
        aria-controls={centrePanelId}
        data-testid="centre-tab-changes"
        className="flex h-[26px] flex-none items-center rounded-[6px] bg-sel px-[9px] text-[12px] font-medium whitespace-nowrap text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Changes
      </button>
    </div>
  );
}

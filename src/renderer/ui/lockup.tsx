const twinPath =
  "M3 0h3v1h-3zM1 1h7v1h-7zM3 2h7v1h-7zM0 3h9v1h-9zM0 4h9v1h-9zM0 5h9v1h-9zM-1 6h7v1h-7zM1 7h7v1h-7zM3 8h3v1h-3z";
const markSize = 18;

export function Lockup({ testId }: { testId: string }) {
  return (
    <div
      data-testid={testId}
      className="flex h-10 flex-none items-center gap-[9px] px-2 font-display text-[22px] leading-none font-bold tracking-[-0.04em] text-fg select-none"
    >
      <svg
        viewBox="-1 0 11 9"
        width={(markSize * 11) / 9}
        height={markSize}
        aria-hidden="true"
        shapeRendering="crispEdges"
        className="flex-none"
      >
        <path fill="currentColor" d={twinPath} />
      </svg>
      satellite
    </div>
  );
}

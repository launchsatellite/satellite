import { useCallback, useEffect, useRef, useState } from "react";
import type { BridgeResult, GhState, ToolCheck, ToolState } from "../../shared/bridge-contract.ts";
import { invoke } from "../bridge/bridge-client.ts";
import { CommandButton } from "../commands/commands-context.tsx";
import { Button } from "../ui/button.tsx";
import { StatusPixel } from "../ui/status-pixel.tsx";

type CheckedTool = keyof ToolCheck;
type Row = { ready: true; detail: string } | { ready: false; detail: string; fix: string };

interface ToolCheckCardProps {
  firstRun: boolean;
  onClose?: () => void;
}

const tools: readonly { tool: CheckedTool; name: string }[] = [
  { tool: "git", name: "Git" },
  { tool: "gh", name: "GitHub CLI" },
  { tool: "claude", name: "Claude Code" },
];
const missingDetail: Record<CheckedTool, string> = {
  git: "git is not installed, or Satellite cannot find it.",
  gh: "GitHub CLI is not installed, or Satellite cannot find it.",
  claude: "Claude Code is not installed, or Satellite cannot find it.",
};
const signedOutDetail = {
  none: "GitHub CLI is not signed in.",
  failed: "GitHub CLI couldn't confirm its sign-in. Check the connection, or sign in again.",
};

function rowOf(tool: CheckedTool, state: ToolState | GhState): Row {
  if (state.state === "missing")
    return { ready: false, detail: missingDetail[tool], fix: state.fix };
  if (state.state === "signed-out") {
    return { ready: false, detail: signedOutDetail[state.reason], fix: state.fix };
  }
  if (!("account" in state)) return { ready: true, detail: `${state.version} found` };
  return {
    ready: true,
    detail: state.account === null ? "Signed in" : `Signed in as ${state.account}`,
  };
}

function CheckRow({
  tool,
  name,
  row,
  first,
}: {
  tool: CheckedTool;
  name: string;
  row: Row | undefined;
  first: boolean;
}) {
  const failing = row !== undefined && !row.ready;
  return (
    <div
      data-testid={`check-${tool}`}
      className={`flex min-h-12 gap-3 px-3 py-3 ${failing ? "items-start" : "items-center"} ${first ? "" : "border-t border-line"}`}
    >
      <span className="flex h-5 flex-none items-center">
        <StatusPixel state={row === undefined ? "idle" : row.ready ? "ready" : "needs-you"} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex flex-wrap items-baseline gap-x-3">
          <span className="font-semibold">{name}</span>
          <span className="text-[12.5px] text-dim">{row?.detail ?? "Checking"}</span>
        </p>
        {failing && (
          <>
            <p className="text-[12.5px] text-fg2">Run this in a terminal, then check again.</p>
            <code className="self-start rounded-[6px] border border-ctl bg-side px-2 py-1 font-mono text-[12px] break-all text-fg select-all">
              {row.fix}
            </code>
          </>
        )}
      </div>
      {row?.ready === true && <span className="font-pixel text-[13px] text-dim uppercase">✓</span>}
    </div>
  );
}

export function ToolCheckCard({ firstRun, onClose }: ToolCheckCardProps) {
  const [result, setResult] = useState<BridgeResult<ToolCheck>>();
  const latest = useRef(0);
  const request = useCallback(() => {
    latest.current += 1;
    const asked = latest.current;
    void invoke("tools.check", {}).then((answer) => {
      if (asked === latest.current) setResult(answer);
    });
  }, []);
  useEffect(request, [request]);
  const checkAgain = () => {
    setResult(undefined);
    request();
  };
  const rows = result?.ok === true ? result.value : undefined;
  const readyCount = tools.filter(
    ({ tool }) => rows !== undefined && rowOf(tool, rows[tool]).ready,
  ).length;
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex min-h-full items-center justify-center">
        <div
          data-testid="tool-check"
          className="flex w-[min(500px,100%)] flex-col gap-[18px] rounded-[12px] border border-line bg-bg px-[34px] pt-[34px] pb-[30px]"
        >
          <h2 className="font-display text-[40px] leading-[0.95] font-bold tracking-[-0.045em]">
            {firstRun ? "welcome to satellite" : "your tools"}
          </h2>
          <p className="-mt-2 text-[14px] text-fg2">
            {firstRun
              ? "Three checks, then add your first project."
              : "Satellite runs your own git, gh and Claude Code."}
          </p>
          <div aria-live="polite" className="overflow-hidden rounded-[10px] border border-line">
            {result?.ok === false ? (
              <p className="px-3 py-3 text-[12.5px] text-fg2">{result.error.message}</p>
            ) : (
              tools.map(({ tool, name }, index) => (
                <CheckRow
                  key={tool}
                  tool={tool}
                  name={name}
                  row={rows === undefined ? undefined : rowOf(tool, rows[tool])}
                  first={index === 0}
                />
              ))
            )}
          </div>
          <div className="flex items-center gap-[10px]">
            <span
              aria-label={`${String(readyCount)} of 3 tools ready`}
              className="mr-auto font-pixel text-[13px] text-dim uppercase"
            >
              {`0${String(readyCount)} / 03`}
            </span>
            <Button variant="ghost" icon="refresh" onClick={checkAgain} testId="check-again">
              Check again
            </Button>
            {firstRun ? (
              <CommandButton command="project.add" testId="add-first-project">
                Add your first project
              </CommandButton>
            ) : (
              <Button
                variant="ghost"
                onClick={() => {
                  onClose?.();
                }}
                testId="close-check"
              >
                Close
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

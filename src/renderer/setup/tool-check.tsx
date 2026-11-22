import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BridgeResult,
  GhState,
  InstallFix,
  ToolCheck,
  ToolState,
} from "../../shared/bridge-contract.ts";
import { invoke } from "../bridge/bridge-client.ts";
import { CommandButton } from "../commands/commands-context.tsx";
import { Button } from "../ui/button.tsx";
import { StatusPixel } from "../ui/status-pixel.tsx";

type CheckedTool = keyof ToolCheck;
type Row =
  | { ready: true; detail: string }
  | { ready: false; detail: string; fix?: { lead: string; text: string } };

interface ToolCheckCardProps {
  firstRun: boolean;
  onClose?: () => void;
}

const tools: readonly { tool: CheckedTool; name: string }[] = [
  { tool: "git", name: "Git" },
  { tool: "gh", name: "GitHub CLI" },
  { tool: "claude", name: "Claude Code" },
];
const missingDetail = "Not installed, or Satellite can't find it.";
const brokenDetail = "Installed, but Satellite couldn't run it.";
const signedOutDetail = {
  none: "Not signed in.",
  failed: "Couldn't confirm its sign-in. Check the connection, or sign in again.",
};
const leads = {
  command: "Run this in a terminal, then check again.",
  address: "Follow the steps at this address, then check again.",
  diagnose: "Run this in a terminal to see why.",
};

function installRow(fix: InstallFix): Row {
  return {
    ready: false,
    detail: missingDetail,
    fix: { lead: leads[fix.kind], text: fix.text },
  };
}

function rowOf(tool: CheckedTool, state: ToolState | GhState): Row {
  switch (state.state) {
    case "missing":
      return installRow(state.fix);
    case "broken":
      return {
        ready: false,
        detail: brokenDetail,
        fix: { lead: leads.diagnose, text: `${tool} --version` },
      };
    case "signed-out":
      return {
        ready: false,
        detail: signedOutDetail[state.reason],
        fix: { lead: leads.command, text: "gh auth login" },
      };
    case "token-refused":
      return {
        ready: false,
        detail: `GitHub refused the token in ${state.variable}, or couldn't be reached. Check the connection, then the token.`,
      };
    case "ready":
      if (!("account" in state)) return { ready: true, detail: `${state.version} found` };
      if (state.account === null) return { ready: true, detail: "Signed in" };
      return {
        ready: true,
        detail:
          state.host === null
            ? `Signed in as ${state.account}`
            : `Signed in as ${state.account} on ${state.host}`,
      };
  }
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
          <span className="text-[12px] text-dim">{row?.detail ?? "Checking"}</span>
        </p>
        {failing && row.fix !== undefined && (
          <>
            <p className="text-[12px] text-fg2">{row.fix.lead}</p>
            <code className="self-start rounded-[6px] border border-ctl bg-side px-2 py-1 font-mono text-[12px] break-words text-fg select-all">
              {row.fix.text}
            </code>
          </>
        )}
      </div>
      {row?.ready === true && (
        <span aria-hidden className="font-pixel text-[13px] text-dim uppercase">
          ✓
        </span>
      )}
    </div>
  );
}

export function ToolCheckCard({ firstRun, onClose }: ToolCheckCardProps) {
  const [result, setResult] = useState<BridgeResult<ToolCheck>>();
  const latest = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const request = useCallback(() => {
    latest.current += 1;
    const asked = latest.current;
    void invoke("tools.check", {}).then((answer) => {
      if (asked === latest.current) setResult(answer);
    });
  }, []);
  useEffect(request, [request]);
  useEffect(() => {
    if (!firstRun) heading.current?.focus();
  }, [firstRun]);
  const checkAgain = () => {
    setResult(undefined);
    request();
  };
  const settled = result !== undefined;
  const rows = result?.ok === true ? result.value : undefined;
  const readyCount = tools.filter(
    ({ tool }) => rows !== undefined && rowOf(tool, rows[tool]).ready,
  ).length;
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="@container flex min-h-full items-center justify-center">
        <div
          data-testid="tool-check"
          className="flex w-[min(500px,100%)] flex-col gap-[18px] rounded-[12px] border border-line bg-bg px-5 pt-6 pb-5 @min-[440px]:px-[34px] @min-[440px]:pt-[34px] @min-[440px]:pb-[30px]"
        >
          <h2
            ref={heading}
            tabIndex={-1}
            className="font-display text-[40px] leading-[0.95] font-bold tracking-[-0.045em] outline-none"
          >
            {firstRun ? "welcome to satellite" : "your tools"}
          </h2>
          <p className="-mt-2 text-[14px] text-fg2">
            {firstRun
              ? "Three checks, then add your first project."
              : "Satellite runs your own git, gh and Claude Code."}
          </p>
          <div
            aria-live="polite"
            aria-busy={!settled}
            className="overflow-hidden rounded-[10px] border border-line"
          >
            {result?.ok === false ? (
              <p className="px-3 py-3 text-[12px] text-fg2">{result.error.message}</p>
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
          <div className="flex flex-wrap items-center justify-end gap-[10px]">
            <span
              data-testid={settled ? "check-count" : undefined}
              className="mr-auto whitespace-nowrap"
            >
              <span aria-hidden className="font-pixel text-[13px] text-dim uppercase">
                {`0${String(readyCount)} / 03`}
              </span>
              <span className="sr-only">{`${String(readyCount)} of 3 tools ready`}</span>
            </span>
            <span className="contents">
              <Button
                variant="ghost"
                icon="refresh"
                onClick={checkAgain}
                disabled={!settled}
                testId="check-again"
              >
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
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

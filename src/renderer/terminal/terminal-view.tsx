import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import {
  bridgeLimits,
  type InstallFix,
  type SessionEnding,
  type WorkspaceRef,
} from "../../shared/bridge-contract.ts";
import { textChunks } from "../../shared/text-chunks.ts";
import { invoke, subscribe } from "../bridge/bridge-client.ts";
import { leads } from "../setup/tool-check.tsx";
import { Button } from "../ui/button.tsx";
import "./terminal-font.css";
import { terminalTheme } from "./terminal-theme.ts";

interface TerminalViewProps {
  terminalId: string;
  workspace: WorkspaceRef;
  resume: boolean;
  shown: boolean;
  onRestart: () => void;
}

const newlineSequence = "\u001b\r";
const endings: Record<SessionEnding, string> = {
  ended: "Claude Code ended.",
  unexpected: "Claude Code stopped unexpectedly. The workspace and its changes are safe.",
  "resume-failed":
    "Claude Code couldn't resume that session, so Satellite let it go. Start a new one.",
};

function isShiftEnter(event: KeyboardEvent): boolean {
  return (
    event.key === "Enter" && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
  );
}

export function TerminalView({
  terminalId,
  workspace,
  resume,
  shown,
  onRestart,
}: TerminalViewProps) {
  const { projectId, workspace: key } = workspace;
  const host = useRef<HTMLDivElement>(null);
  const show = useRef<() => void>(undefined);
  const noticedNow = useRef(false);
  const [notice, setNotice] = useState<string>();
  const [missingFix, setMissingFix] = useState<InstallFix>();
  const noticed = notice !== undefined;

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const terminal = new Terminal({
      fontFamily: '"Satellite Terminal Mono", monospace',
      fontSize: 13,
      scrollback: 5000,
      allowProposedApi: true,
      cursorBlink: !matchMedia("(prefers-reduced-motion: reduce)").matches,
      theme: terminalTheme(),
      linkHandler: { activate: () => undefined },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = "11";
    terminal.open(element);
    const fitted = () => {
      if (element.clientWidth === 0 || element.clientHeight === 0) return false;
      fit.fit();
      return true;
    };
    fitted();
    let sent = { cols: terminal.cols, rows: terminal.rows };

    const stopData = subscribe("terminal.data", ({ id, data }) => {
      if (id !== terminalId) return;
      terminal.write(data, () => {
        void invoke("terminal.ack", { id, chars: data.length });
      });
    });
    const stopExit = subscribe("terminal.exit", ({ id, ending }) => {
      if (id === terminalId) setNotice(endings[ending]);
    });
    let queue: Promise<unknown> = invoke("terminal.start", {
      id: terminalId,
      program: "claude",
      workspace: { projectId, workspace: key },
      resume,
      cols: sent.cols,
      rows: sent.rows,
    }).then(async (result) => {
      if (result.ok) return;
      setNotice(result.error.message);
      if (result.error.code !== "tool-missing") return;
      const check = await invoke("tools.check", {});
      if (check.ok && check.value.claude.state === "missing") setMissingFix(check.value.claude.fix);
    });
    const send = (data: string) => {
      for (const chunk of textChunks(data, bridgeLimits.terminalWriteChars)) {
        queue = queue.then(() => invoke("terminal.write", { id: terminalId, data: chunk }));
      }
    };
    const sendSize = () => {
      if (!fitted()) return;
      const { cols, rows } = terminal;
      if (cols === sent.cols && rows === sent.rows) return;
      sent = { cols, rows };
      queue = queue.then(() => invoke("terminal.resize", { id: terminalId, cols, rows }));
    };

    const input = terminal.onData(send);
    terminal.attachCustomKeyEventHandler((event) => {
      if (!isShiftEnter(event)) return true;
      if (event.type === "keydown") send(newlineSequence);
      return false;
    });

    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sendSize);
    });
    observer.observe(element);
    show.current = () => {
      sendSize();
      if (!noticedNow.current) terminal.focus();
    };

    const darkScheme = matchMedia("(prefers-color-scheme: dark)");
    const retheme = () => {
      terminal.options.theme = terminalTheme();
    };
    darkScheme.addEventListener("change", retheme);

    return () => {
      show.current = undefined;
      darkScheme.removeEventListener("change", retheme);
      observer.disconnect();
      cancelAnimationFrame(frame);
      input.dispose();
      stopData();
      stopExit();
      terminal.dispose();
      void invoke("terminal.close", { id: terminalId });
    };
  }, [terminalId, projectId, key, resume]);

  useEffect(() => {
    noticedNow.current = noticed;
  }, [noticed]);

  useEffect(() => {
    if (shown) show.current?.();
  }, [shown]);

  return (
    <div
      data-testid={shown ? "terminal" : undefined}
      className="flex h-full min-h-0 flex-col bg-bg p-2"
    >
      <div ref={host} className="min-h-0 flex-1" />
      {shown && (
        <div className={`flex flex-col gap-2 px-1 ${noticed ? "pt-2" : ""}`}>
          <div className="flex flex-wrap items-center gap-3">
            <p role="status" data-testid="terminal-notice" className="text-[13px] text-fg2">
              {notice}
            </p>
            {noticed && (
              <Button testId="start-claude" onClick={onRestart} autoFocus>
                Start Claude Code
              </Button>
            )}
          </div>
          {missingFix !== undefined && (
            <div className="flex flex-col gap-1">
              <p className="text-[12.5px] text-fg2">{leads[missingFix.kind]}</p>
              <code
                data-testid="claude-missing-fix"
                className="self-start rounded-[6px] border border-ctl bg-side px-2 py-1 font-mono text-[12px] break-words text-fg select-all"
              >
                {missingFix.text}
              </code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

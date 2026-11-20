import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { bridgeLimits } from "../../shared/bridge-contract.ts";
import { invoke, subscribe } from "../bridge/bridge-client.ts";
import "./terminal-font.css";
import { terminalTheme } from "./terminal-theme.ts";

const newlineSequence = "\u001b\r";

function chunks(data: string): string[] {
  const pieces: string[] = [];
  let start = 0;
  while (start < data.length) {
    let end = Math.min(start + bridgeLimits.terminalWriteChars, data.length);
    const last = data.charCodeAt(end - 1);
    if (end < data.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    pieces.push(data.slice(start, end));
    start = end;
  }
  return pieces;
}

function isShiftEnter(event: KeyboardEvent): boolean {
  return (
    event.key === "Enter" && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
  );
}

export function TerminalView({ terminalId }: { terminalId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const terminal = new Terminal({
      fontFamily: '"Satellite Terminal Mono", monospace',
      fontSize: 13,
      scrollback: 5000,
      allowProposedApi: true,
      cursorBlink: true,
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = "11";
    terminal.open(element);
    fit.fit();
    terminal.focus();

    const stopData = subscribe("terminal.data", ({ id, data }) => {
      if (id === terminalId) terminal.write(data);
    });
    const stopExit = subscribe("terminal.exit", ({ id }) => {
      if (id === terminalId) setNotice("Claude Code ended.");
    });
    let queue: Promise<unknown> = invoke("terminal.start", {
      id: terminalId,
      program: "claude",
      cols: terminal.cols,
      rows: terminal.rows,
    }).then((result) => {
      if (!result.ok) setNotice(result.error.message);
    });
    const send = (data: string) => {
      for (const chunk of chunks(data)) {
        queue = queue.then(() => invoke("terminal.write", { id: terminalId, data: chunk }));
      }
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
      frame = requestAnimationFrame(() => {
        const { cols, rows } = terminal;
        fit.fit();
        if (terminal.cols === cols && terminal.rows === rows) return;
        const size = { id: terminalId, cols: terminal.cols, rows: terminal.rows };
        queue = queue.then(() => invoke("terminal.resize", size));
      });
    });
    observer.observe(element);

    const darkScheme = matchMedia("(prefers-color-scheme: dark)");
    const retheme = () => {
      terminal.options.theme = terminalTheme();
    };
    darkScheme.addEventListener("change", retheme);

    return () => {
      darkScheme.removeEventListener("change", retheme);
      observer.disconnect();
      cancelAnimationFrame(frame);
      input.dispose();
      stopData();
      stopExit();
      terminal.dispose();
      void invoke("terminal.close", { id: terminalId });
    };
  }, [terminalId]);

  return (
    <div data-testid="terminal" className="flex h-full min-h-0 flex-col bg-bg p-2">
      <div ref={host} className="min-h-0 flex-1" />
      {notice !== undefined && <p className="px-1 pt-2 text-[13px] text-dim">{notice}</p>}
    </div>
  );
}

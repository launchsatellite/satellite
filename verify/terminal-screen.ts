import type { Terminal } from "@xterm/xterm";
import type { Page } from "playwright-core";

export interface TerminalScreen {
  renderer: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  naturalLineHeight: number;
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  left: number;
  top: number;
  width: number;
  height: number;
  background: string;
  backgroundToken: string;
  lines: string[];
}

export async function readTerminal(page: Page): Promise<TerminalScreen | null> {
  return page.evaluate(() => {
    const host = document.querySelector<HTMLElement & { terminal?: Terminal }>(
      '[data-testid="terminal"] [data-renderer]',
    );
    const terminal = host?.terminal;
    const screen = host?.querySelector(".xterm-screen");
    if (host === null || terminal === undefined || screen === null || screen === undefined) {
      return null;
    }
    const sample = document.createElement("span");
    sample.textContent = "Mg";
    sample.style.font = `${String(terminal.options.fontSize)}px ${terminal.options.fontFamily ?? ""}`;
    sample.style.lineHeight = "normal";
    sample.style.position = "absolute";
    sample.style.whiteSpace = "pre";
    document.body.append(sample);
    const naturalLineHeight = sample.getBoundingClientRect().height;
    sample.remove();
    const box = screen.getBoundingClientRect();
    const buffer = terminal.buffer.active;
    const lines: string[] = [];
    for (let row = 0; row < terminal.rows; row += 1) {
      lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? "");
    }
    return {
      renderer: host.getAttribute("data-renderer") ?? "",
      fontFamily: terminal.options.fontFamily ?? "",
      fontSize: terminal.options.fontSize ?? 0,
      lineHeight: terminal.options.lineHeight ?? 0,
      naturalLineHeight,
      cols: terminal.cols,
      rows: terminal.rows,
      cellWidth: box.width / terminal.cols,
      cellHeight: box.height / terminal.rows,
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      background: terminal.options.theme?.background ?? "",
      backgroundToken: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
      lines,
    };
  });
}

export async function terminalText(page: Page): Promise<string> {
  const lines = (await readTerminal(page))?.lines ?? [];
  const notice = page.getByTestId("terminal-notice");
  const sentence = (await notice.count()) === 0 ? "" : await notice.innerText();
  return [...lines, sentence].join("\n");
}

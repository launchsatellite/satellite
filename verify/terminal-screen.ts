import type { Terminal } from "@xterm/xterm";
import type { Page } from "playwright-core";

export interface TerminalScreen {
  renderer: string;
  fontFamily: string;
  resolvedFamily: string;
  advance: number;
  fontSize: number;
  lineHeight: number;
  naturalLineHeight: number;
  scale: number;
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  left: number;
  top: number;
  width: number;
  height: number;
  paneWidth: number;
  paneHeight: number;
  background: string;
  backgroundToken: string;
  lines: string[];
  columns: number[][];
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
    const fontFamily = terminal.options.fontFamily ?? "";
    const fontSize = terminal.options.fontSize ?? 0;
    const paint = document.createElement("canvas").getContext("2d");
    if (paint === null) return null;
    const widthIn = (font: string) => {
      paint.font = font;
      return paint.measureText("mmmmmmmmmmlli0WW").width;
    };
    const families = fontFamily.split(",").map((family) => family.trim());
    const resolvedFamily =
      families.find(
        (family) =>
          family === "monospace" ||
          widthIn(`72px ${family}, serif`) !== widthIn("72px serif") ||
          widthIn(`72px ${family}, sans-serif`) !== widthIn("72px sans-serif"),
      ) ?? "";
    paint.font = `${String(fontSize)}px ${fontFamily}`;
    const advance = paint.measureText("W").width;
    const sample = document.createElement("span");
    sample.textContent = "Mg";
    sample.style.font = `${String(fontSize)}px ${fontFamily}`;
    sample.style.lineHeight = "normal";
    sample.style.position = "absolute";
    sample.style.whiteSpace = "pre";
    document.body.append(sample);
    const naturalLineHeight = sample.getBoundingClientRect().height;
    sample.remove();
    const box = screen.getBoundingClientRect();
    const buffer = terminal.buffer.active;
    const lines: string[] = [];
    const columns: number[][] = [];
    for (let row = 0; row < terminal.rows; row += 1) {
      const line = buffer.getLine(buffer.viewportY + row);
      let text = "";
      const at: number[] = [];
      for (let column = 0; line !== undefined && column < terminal.cols; column += 1) {
        const cell = line.getCell(column);
        if (cell === undefined || cell.getWidth() === 0) continue;
        const chars = cell.getChars() || " ";
        text += chars;
        at.push(...Array.from({ length: chars.length }, () => column));
      }
      const trimmed = text.trimEnd();
      lines.push(trimmed);
      columns.push(at.slice(0, trimmed.length));
    }
    return {
      renderer: host.getAttribute("data-renderer") ?? "",
      fontFamily,
      resolvedFamily,
      advance,
      fontSize,
      lineHeight: terminal.options.lineHeight ?? 0,
      naturalLineHeight,
      scale: devicePixelRatio,
      cols: terminal.cols,
      rows: terminal.rows,
      cellWidth: box.width / terminal.cols,
      cellHeight: box.height / terminal.rows,
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      paneWidth: host.clientWidth,
      paneHeight: host.clientHeight,
      background: terminal.options.theme?.background ?? "",
      backgroundToken: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
      lines,
      columns,
    };
  });
}

export async function terminalText(page: Page): Promise<string> {
  const lines = (await readTerminal(page))?.lines ?? [];
  const notice = page.getByTestId("terminal-notice");
  const sentence = (await notice.count()) === 0 ? "" : await notice.innerText();
  return [...lines, sentence].join("\n");
}

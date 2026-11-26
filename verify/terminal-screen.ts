import type { Terminal } from "@xterm/xterm";
import type { Page } from "playwright-core";

interface TerminalScreen {
  cellWidth: number;
  cellHeight: number;
  left: number;
  top: number;
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
      cellWidth: box.width / terminal.cols,
      cellHeight: box.height / terminal.rows,
      left: box.left,
      top: box.top,
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

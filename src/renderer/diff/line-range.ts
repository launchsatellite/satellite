export interface LineSelection {
  startLine: number;
  endLine: number;
  endColumn: number;
  empty: boolean;
}

export interface LineRange {
  start: number;
  end: number;
}

export function lineRange(selection: LineSelection, lastLine: number): LineRange | null {
  if (selection.empty || selection.startLine > lastLine) return null;
  const { startLine, endLine, endColumn } = selection;
  const end = endLine > startLine && endColumn === 1 ? endLine - 1 : endLine;
  return { start: startLine, end: Math.min(end, lastLine) };
}

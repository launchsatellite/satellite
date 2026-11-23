export interface CodeType {
  fontFamily: string;
  fontSize: number;
  terminalLineHeight: number;
}

const mac: CodeType = {
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  fontSize: 12,
  terminalLineHeight: 1,
};

const windows: CodeType = {
  fontFamily: 'Consolas, "Courier New", monospace',
  fontSize: 14,
  terminalLineHeight: 1,
};

const linux: CodeType = {
  fontFamily: '"Droid Sans Mono", monospace',
  fontSize: 14,
  terminalLineHeight: 1.1,
};

export function codeTypeFor(userAgent: string): CodeType {
  if (userAgent.includes("Mac")) return mac;
  if (userAgent.includes("Windows")) return windows;
  return linux;
}

export const codeType = codeTypeFor(navigator.userAgent);

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export interface ProcessEntry {
  readonly pid: number;
  readonly parent: number;
  readonly group: number;
  readonly identity: string;
  readonly started: number | null;
  readonly defunct: boolean;
  readonly name: string;
  readonly command: string;
}

const windowsRow = z.object({
  p: z.int().min(0),
  pp: z.int().min(0),
  s: z.int().nullable(),
  n: z.string().nullable(),
});
const windowsCommandRow = z.object({
  p: z.int().min(1),
  s: z.int().nullable(),
  c: z.string().nullable(),
});

export const windowsStartOf = (row: string) =>
  `([DateTimeOffset]${row}.CreationDate).ToUnixTimeMilliseconds()`;
export const psTimeoutMs = 1000;
export const windowsReadTimeoutMs = 5000;
const outputLimit = 16 * 1024 * 1024;
const psPaths = ["/bin/ps", "/usr/bin/ps"];
const psArguments = [
  "-A",
  "-ww",
  "-o",
  "pid=",
  "-o",
  "ppid=",
  "-o",
  "pgid=",
  "-o",
  "stat=",
  "-o",
  "lstart=",
  "-o",
  process.platform === "darwin" ? "ucomm=" : "comm=",
];
const commandReadLimit = 1000;
const commandLengthLimit = 2000;
const psCommandRow =
  /^\s*(\d+) +\w{3} +(\w{3}) +(\d{1,2}) +(\d\d):(\d\d):(\d\d) +(\d{4})(?: (.*))?$/;
const commandIdsVariable = "SATELLITE_PROCESS_IDS";
const windowsTableScript = `$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);ConvertTo-Json -Compress -InputObject @(Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,CreationDate,Name|ForEach-Object{[pscustomobject]@{p=[int64]$_.ProcessId;pp=[int64]$_.ParentProcessId;s=$(if($_.CreationDate){${windowsStartOf("$_")}}else{$null});n=$_.Name}})`;
const windowsCommandScript = `$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$ids=@($env:${commandIdsVariable}.Split(',')|ForEach-Object{[int64]$_});ConvertTo-Json -Compress -InputObject @(Get-CimInstance -ClassName Win32_Process -Property ProcessId,CreationDate,CommandLine|Where-Object{$ids -contains $_.ProcessId}|ForEach-Object{[pscustomobject]@{p=[int64]$_.ProcessId;s=$(if($_.CreationDate){${windowsStartOf("$_")}}else{$null});c=$(if($_.CommandLine){$_.CommandLine.Substring(0,[Math]::Min(${String(commandLengthLimit)},$_.CommandLine.Length))}else{$null})}})`;
const psRow =
  /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\w{3}) +(\w{3}) +(\d{1,2}) +(\d\d):(\d\d):(\d\d) +(\d{4})(?: +(.*))?$/;
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function startOf(
  month: string,
  day: string,
  hour: string,
  minute: string,
  second: string,
  year: string,
): number | null {
  const monthIndex = months.indexOf(month);
  if (monthIndex < 0) return null;
  return Date.UTC(
    Number(year),
    monthIndex,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

function withoutDuplicateIds(entries: readonly ProcessEntry[]): ProcessEntry[] {
  const counts = new Map<number, number>();
  for (const entry of entries) counts.set(entry.pid, (counts.get(entry.pid) ?? 0) + 1);
  return entries.filter((entry) => counts.get(entry.pid) === 1);
}

function programName(command: string): string {
  const program = command.split(" ", 1)[0] ?? "";
  return program
    .slice(program.lastIndexOf("/") + 1)
    .replace(/^-/, "")
    .toLowerCase();
}

function readOutput(
  file: string,
  args: readonly string[],
  options: {
    env?: NodeJS.ProcessEnv;
    timeout: number;
    windowsHide?: boolean;
    keepOnExitStatus?: boolean;
  },
): Promise<string | null> {
  const { keepOnExitStatus = false, ...execOptions } = options;
  return new Promise((resolve) => {
    const child = execFile(
      file,
      args,
      { encoding: "utf8", maxBuffer: outputLimit, ...execOptions },
      (error, stdout) => {
        const exited = keepOnExitStatus && typeof error?.code === "number" && !error.killed;
        resolve(error === null || exited ? stdout : null);
      },
    );
    child.stdin?.end();
  });
}

export function parsePsTable(text: string): ProcessEntry[] {
  const entries: ProcessEntry[] = [];
  for (const line of text.split("\n")) {
    const match = psRow.exec(line);
    if (match === null) continue;
    const [, pid = "", parent = "", group = "", stat = "", weekday = "", month = "", day = ""] =
      match;
    const [hour = "", minute = "", second = "", year = "", rest = ""] = match.slice(8);
    const id = Number(pid);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const command = rest.trimEnd();
    entries.push({
      pid: id,
      parent: Number(parent),
      group: Number(group),
      identity: `${pid} ${weekday} ${month} ${day} ${hour}:${minute}:${second} ${year}`,
      started: startOf(month, day, hour, minute, second, year),
      defunct: stat.startsWith("Z"),
      name: programName(command),
      command,
    });
  }
  return withoutDuplicateIds(entries);
}

export function parseWindowsTable(text: string): ProcessEntry[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  const entries: ProcessEntry[] = [];
  for (const candidate of Array.isArray(json) ? json : [json]) {
    const parsed = windowsRow.safeParse(candidate);
    if (!parsed.success) continue;
    const row = parsed.data;
    if (row.p === 0) continue;
    entries.push({
      pid: row.p,
      parent: row.pp,
      group: 0,
      identity: `${String(row.p)} ${String(row.s)}`,
      started: row.s,
      defunct: false,
      name: (row.n ?? "").toLowerCase().replace(/\.exe$/, ""),
      command: row.n ?? "",
    });
  }
  return withoutDuplicateIds(entries);
}

export function parsePsCommands(
  text: string,
  starts: ReadonlyMap<number, number | null>,
): Map<number, string> {
  const commands = new Map<number, string>();
  for (const line of text.split("\n")) {
    const match = psCommandRow.exec(line);
    if (match === null) continue;
    const [, pid = "", month = "", day = "", hour = "", minute = "", second = "", year = ""] =
      match;
    const id = Number(pid);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const started = startOf(month, day, hour, minute, second, year);
    if (!startsMatch(starts.get(id) ?? null, started)) continue;
    commands.set(id, (match[8] ?? "").trimEnd().slice(0, commandLengthLimit));
  }
  return commands;
}

export function parseWindowsCommands(
  text: string,
  starts: ReadonlyMap<number, number | null>,
): Map<number, string> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return new Map();
  }
  const commands = new Map<number, string>();
  for (const candidate of Array.isArray(json) ? json : [json]) {
    const parsed = windowsCommandRow.safeParse(candidate);
    if (
      parsed.success &&
      parsed.data.c !== null &&
      startsMatch(starts.get(parsed.data.p) ?? null, parsed.data.s)
    ) {
      commands.set(parsed.data.p, parsed.data.c.slice(0, commandLengthLimit));
    }
  }
  return commands;
}

const startToleranceMs = process.platform === "linux" ? 1000 : 0;

export function startsMatch(
  listed: number | null,
  read: number | null,
  toleranceMs: number = startToleranceMs,
): boolean {
  return listed !== null && read !== null && Math.abs(listed - read) <= toleranceMs;
}

export function sameProcess(first: ProcessEntry, second: ProcessEntry): boolean {
  return (
    first.pid === second.pid &&
    (first.identity === second.identity || startsMatch(first.started, second.started))
  );
}

export function subtreeOf(root: ProcessEntry, entries: readonly ProcessEntry[]): ProcessEntry[] {
  const children = new Map<number, ProcessEntry[]>();
  for (const entry of entries) {
    const siblings = children.get(entry.parent);
    if (siblings === undefined) children.set(entry.parent, [entry]);
    else siblings.push(entry);
  }
  const found = [root];
  const seen = new Set([root.pid]);
  const byPid = new Map(entries.map((entry) => [entry.pid, entry]));
  for (let above = byPid.get(root.parent); above !== undefined && !seen.has(above.pid);) {
    seen.add(above.pid);
    above = byPid.get(above.parent);
  }
  for (const current of found) {
    if (current.started === null) continue;
    for (const child of children.get(current.pid) ?? []) {
      if (seen.has(child.pid) || child.started === null || current.started > child.started) {
        continue;
      }
      seen.add(child.pid);
      found.push(child);
    }
  }
  return found;
}

export function windowsPowerShell(): string {
  return join(
    process.env["SystemRoot"] ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

export async function readProcessTable(): Promise<ProcessEntry[]> {
  if (process.platform === "win32") {
    const text = await readOutput(
      windowsPowerShell(),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", windowsTableScript],
      { timeout: windowsReadTimeoutMs, windowsHide: true },
    );
    return text === null ? [] : parseWindowsTable(text);
  }
  if (process.platform !== "darwin" && process.platform !== "linux") return [];
  const ps = psPaths.find((path) => existsSync(path));
  if (ps === undefined) return [];
  const text = await readOutput(ps, psArguments, {
    env: { LC_ALL: "C", TZ: "UTC" },
    timeout: psTimeoutMs,
  });
  return text === null ? [] : parsePsTable(text);
}

export async function readCommands(
  entries: readonly Pick<ProcessEntry, "pid" | "started">[],
): Promise<Map<number, string>> {
  const starts = new Map(entries.map(({ pid, started }) => [pid, started]));
  const ids = [...starts.keys()].filter((pid) => Number.isSafeInteger(pid) && pid > 0);
  if (ids.length === 0 || ids.length > commandReadLimit) return new Map();
  if (process.platform === "win32") {
    const text = await readOutput(
      windowsPowerShell(),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", windowsCommandScript],
      {
        env: { ...process.env, [commandIdsVariable]: ids.join(",") },
        timeout: windowsReadTimeoutMs,
        windowsHide: true,
      },
    );
    return text === null ? new Map() : parseWindowsCommands(text, starts);
  }
  if (process.platform !== "darwin" && process.platform !== "linux") return new Map();
  const ps = psPaths.find((path) => existsSync(path));
  if (ps === undefined) return new Map();
  const text = await readOutput(
    ps,
    ["-ww", "-o", "pid=", "-o", "lstart=", "-o", "command=", "-p", ids.join(",")],
    { env: { LC_ALL: "C", TZ: "UTC" }, timeout: psTimeoutMs, keepOnExitStatus: true },
  );
  return text === null ? new Map() : parsePsCommands(text, starts);
}

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
  c: z.string().nullable(),
});
const windowsRows = z.union([windowsRow.transform((row) => [row]), z.array(windowsRow)]);

export const psTimeoutMs = 1000;
const windowsReadTimeoutMs = 5000;
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
  "command=",
];
const windowsTableScript =
  "$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);ConvertTo-Json -Compress -InputObject @(Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,CreationDate,Name,CommandLine|ForEach-Object{[pscustomobject]@{p=[int64]$_.ProcessId;pp=[int64]$_.ParentProcessId;s=$(if($_.CreationDate){([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()}else{$null});n=$_.Name;c=$_.CommandLine}})";
const psRow =
  /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\w{3}) +(\w{3}) +(\d{1,2}) +(\d\d):(\d\d):(\d\d) +(\d{4})(?: +(.*))?$/;
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
  options: { env?: NodeJS.ProcessEnv; timeout: number; windowsHide?: boolean },
): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(
      file,
      args,
      { encoding: "utf8", maxBuffer: outputLimit, ...options },
      (error, stdout) => {
        resolve(error === null ? stdout : null);
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
    const monthIndex = months.indexOf(month);
    const command = rest.trimEnd();
    entries.push({
      pid: id,
      parent: Number(parent),
      group: Number(group),
      identity: `${pid} ${weekday} ${month} ${day} ${hour}:${minute}:${second} ${year}`,
      started:
        monthIndex < 0
          ? null
          : Date.UTC(
              Number(year),
              monthIndex,
              Number(day),
              Number(hour),
              Number(minute),
              Number(second),
            ),
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
  const parsed = windowsRows.safeParse(json);
  if (!parsed.success) return [];
  const entries: ProcessEntry[] = [];
  for (const row of parsed.data) {
    if (row.p === 0) continue;
    entries.push({
      pid: row.p,
      parent: row.pp,
      group: 0,
      identity: `${String(row.p)} ${String(row.s)}`,
      started: row.s,
      defunct: false,
      name: (row.n ?? "").toLowerCase().replace(/\.exe$/, ""),
      command: row.c ?? row.n ?? "",
    });
  }
  return withoutDuplicateIds(entries);
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

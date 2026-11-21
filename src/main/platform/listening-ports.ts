import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { z } from "zod";
import { windowsPowerShell } from "./process-table.ts";

export interface ListeningPort {
  readonly pid: number;
  readonly host: string;
  readonly port: number;
}

const windowsPort = z.object({ a: z.string(), p: z.int(), o: z.int().min(0) });

const portsTimeoutMs = 3000;
const portPids = 500;
const outputLimit = 16 * 1024 * 1024;
const lsofPath = "/usr/sbin/lsof";
const ssPaths = ["/usr/bin/ss", "/usr/sbin/ss", "/sbin/ss", "/bin/ss"];
const ssOwner = /,pid=(\d+),fd=\d+\)/g;
const windowsPortsScript =
  "$ErrorActionPreference='Stop';ConvertTo-Json -Compress -InputObject @(Get-CimInstance -Namespace root/StandardCimv2 -ClassName MSFT_NetTCPConnection -Filter 'State = 2' -Property LocalAddress,LocalPort,OwningProcess|ForEach-Object{[pscustomobject]@{a=$_.LocalAddress;p=[int]$_.LocalPort;o=[int64]$_.OwningProcess}})";

function listener(pid: number, rawHost: string, rawPort: string | number): ListeningPort | null {
  const host = rawHost.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const port =
    typeof rawPort === "number" ? rawPort : /^\d{1,5}$/.test(rawPort) ? Number(rawPort) : 0;
  if (isIP(host) === 0 || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!Number.isSafeInteger(pid) || pid < 0) return null;
  return { pid, host, port };
}

function splitAddress(address: string): { host: string; port: string } | null {
  const colon = address.lastIndexOf(":");
  if (colon < 1) return null;
  return { host: address.slice(0, colon), port: address.slice(colon + 1) };
}

function run(
  file: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; windowsHide?: boolean; keepExitCode?: boolean },
): Promise<string> {
  return new Promise((resolve) => {
    const child = execFile(
      file,
      args,
      { encoding: "utf8", maxBuffer: outputLimit, timeout: portsTimeoutMs, ...options },
      (error, stdout) => {
        const exitedNormally =
          error === null ||
          (options.keepExitCode === true &&
            typeof error.code === "number" &&
            error.killed !== true);
        resolve(exitedNormally ? stdout : "");
      },
    );
    child.stdin?.end();
  });
}

export function parseLsof(text: string): ListeningPort[] {
  const ports: ListeningPort[] = [];
  let pid = -1;
  let family: "IPv4" | "IPv6" | null = null;
  for (const line of text.split("\n")) {
    if (/^p\d+$/.test(line)) {
      pid = Number(line.slice(1));
      family = null;
    } else if (line.startsWith("f")) {
      family = null;
    } else if (line === "tIPv4" || line === "tIPv6") {
      family = line.slice(1) === "IPv4" ? "IPv4" : "IPv6";
    } else if (line.startsWith("n")) {
      const address = splitAddress(line.slice(1));
      if (address === null || pid < 0) continue;
      let host = address.host;
      if (host === "*") {
        if (family === null) continue;
        host = family === "IPv4" ? "0.0.0.0" : "::";
      }
      const found = listener(pid, host, address.port);
      if (found !== null) ports.push(found);
    }
  }
  return ports;
}

export function parseSs(text: string): ListeningPort[] {
  const ports: ListeningPort[] = [];
  for (const line of text.split("\n")) {
    const tokens = line.trim().split(/\s+/);
    if (tokens[0] !== "LISTEN") continue;
    const address = splitAddress(tokens[3] ?? "");
    if (address === null) continue;
    const host = address.host === "*" ? "::" : address.host;
    for (const owner of line.matchAll(ssOwner)) {
      const found = listener(Number(owner[1]), host, address.port);
      if (found !== null) ports.push(found);
    }
  }
  return ports;
}

export function parseWindowsPorts(text: string): ListeningPort[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  return (Array.isArray(json) ? json : [json]).flatMap((candidate) => {
    const parsed = windowsPort.safeParse(candidate);
    return parsed.success ? (listener(parsed.data.o, parsed.data.a, parsed.data.p) ?? []) : [];
  });
}

async function readAll(pids: readonly number[]): Promise<ListeningPort[]> {
  if (process.platform === "darwin") {
    if (!existsSync(lsofPath)) return [];
    const text = await run(
      lsofPath,
      ["-nP", "-iTCP", "-sTCP:LISTEN", "-a", "-p", pids.join(","), "-F", "pPnt"],
      { env: { LC_ALL: "C" }, keepExitCode: true },
    );
    return parseLsof(text);
  }
  if (process.platform === "linux") {
    const ss = ssPaths.find((path) => existsSync(path));
    if (ss === undefined) return [];
    return parseSs(await run(ss, ["-H", "-l", "-t", "-n", "-p"], { env: { LC_ALL: "C" } }));
  }
  if (process.platform === "win32") {
    const text = await run(
      windowsPowerShell(),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", windowsPortsScript],
      { windowsHide: true },
    );
    return parseWindowsPorts(text);
  }
  return [];
}

export async function readListeningPorts(pids: readonly number[]): Promise<ListeningPort[]> {
  const asked = new Set(pids.slice(0, portPids));
  if (asked.size === 0) return [];
  const ports = await readAll([...asked]);
  return ports.filter((port) => asked.has(port.pid));
}

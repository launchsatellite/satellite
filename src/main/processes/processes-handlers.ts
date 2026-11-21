import { processesLimits, processRow, type ProcessRow } from "../../shared/bridge-contract.ts";
import { BridgeFailure, type BridgeHandlers, type BridgeOwner } from "../bridge/registry.ts";
import { type ListeningPort, readListeningPorts } from "../platform/listening-ports.ts";
import { type ProcessEntry, readProcessTable } from "../platform/process-table.ts";
import { endSubtree } from "../platform/process-tree.ts";
import { userHomeFolder } from "../platform/satellite-home.ts";
import { shownCommand } from "./command-text.ts";
import {
  listedProcesses,
  ownedProcess,
  type OwnedProcess,
  type SessionRoot,
} from "./listed-processes.ts";
import { portUrl } from "./port-address.ts";

export interface Processes {
  handlers: Pick<BridgeHandlers, "processes.list" | "processes.stop">;
}

export interface RunningRoot {
  readonly owner: BridgeOwner;
  readonly root: SessionRoot;
}

interface ProcessesOptions {
  roots: () => readonly RunningRoot[];
  readTable?: () => Promise<ProcessEntry[]>;
  readPorts?: (pids: readonly number[]) => Promise<ListeningPort[]>;
  end?: (target: ProcessEntry) => Promise<void>;
  now?: () => number;
  home?: string;
}

interface Snapshot {
  readonly at: number;
  readonly rows: readonly { readonly owner: BridgeOwner; readonly row: ProcessRow }[];
}

const tableReuseMs = 2000;

function portsOf(
  subtree: readonly ProcessEntry[],
  ports: readonly ListeningPort[],
): ProcessRow["ports"] {
  const members = new Set(subtree.map((entry) => entry.pid));
  const hostsByPort = new Map<number, string[]>();
  for (const listener of ports) {
    if (!members.has(listener.pid)) continue;
    const hosts = hostsByPort.get(listener.port);
    if (hosts === undefined) hostsByPort.set(listener.port, [listener.host]);
    else hosts.push(listener.host);
  }
  return [...hostsByPort]
    .sort(([first], [second]) => first - second)
    .slice(0, processesLimits.ports)
    .map(([port, hosts]) => ({ port, url: portUrl(hosts, port) }));
}

function rowOf(
  owned: OwnedProcess,
  ports: readonly ListeningPort[],
  home: string,
): ProcessRow | undefined {
  const { entry, root, subtree } = owned;
  const command = shownCommand(entry.command, home);
  const parsed = processRow.safeParse({
    workspace: root.workspace,
    session: root.session,
    pid: entry.pid,
    started: entry.started,
    command: command.text,
    cut: command.cut,
    ports: portsOf(subtree, ports),
  });
  return parsed.success ? parsed.data : undefined;
}

export function createProcesses({
  roots,
  readTable = readProcessTable,
  readPorts = readListeningPorts,
  end = endSubtree,
  now = Date.now,
  home = userHomeFolder(),
}: ProcessesOptions): Processes {
  let reading: Promise<Snapshot> | undefined;
  let finished: { readonly snapshot: Snapshot; readonly at: number } | undefined;
  let generation = 0;
  let stopping = false;

  const read = async (): Promise<Snapshot> => {
    const at = now();
    const running = roots();
    if (running.length === 0) return { at, rows: [] };
    const table = await readTable();
    const listed = listedProcesses(
      table,
      running.map(({ root }) => root),
      at,
    );
    if (listed.length === 0) return { at, rows: [] };
    const ports = await readPorts(listed.flatMap(({ subtree }) => subtree.map(({ pid }) => pid)));
    const rows = listed.flatMap((owned) => {
      const row = rowOf(owned, ports, home);
      const owner = running.find(({ root }) => root === owned.root)?.owner;
      return row === undefined || owner === undefined ? [] : [{ owner, row }];
    });
    return { at, rows };
  };

  const snapshot = (): Promise<Snapshot> => {
    if (reading !== undefined) return reading;
    if (finished !== undefined && now() - finished.at < tableReuseMs) {
      return Promise.resolve(finished.snapshot);
    }
    const startedIn = generation;
    const current = read()
      .then((result) => {
        if (generation === startedIn) finished = { snapshot: result, at: now() };
        return result;
      })
      .finally(() => {
        reading = undefined;
      });
    reading = current;
    return current;
  };

  const dropRead = () => {
    generation += 1;
    finished = undefined;
  };

  return {
    handlers: {
      "processes.list": async (_request, owner) => {
        const { at, rows } = await snapshot();
        const mine = rows.filter((candidate) => candidate.owner === owner);
        return {
          at,
          rows: mine.slice(0, processesLimits.rows).map(({ row }) => row),
          more: Math.max(0, mine.length - processesLimits.rows),
        };
      },
      "processes.stop": async ({ pid, started }, owner) => {
        if (stopping) {
          throw new BridgeFailure(
            "limit",
            "Satellite is already stopping a process. Try again in a moment.",
          );
        }
        const own = roots()
          .filter((running) => running.owner === owner)
          .map(({ root }) => root);
        if (own.length === 0) throw new BridgeFailure("not-found", "That process already ended.");
        stopping = true;
        dropRead();
        try {
          const table = await readTable();
          if (table.length === 0) {
            throw new BridgeFailure(
              "failed",
              "Satellite couldn't read the running processes, so it stopped nothing.",
            );
          }
          const owned = ownedProcess(table, own, pid, started, now());
          if (owned === undefined)
            throw new BridgeFailure("not-found", "That process already ended.");
          await end(owned.entry);
          return {};
        } finally {
          stopping = false;
          dropRead();
        }
      },
    },
  };
}

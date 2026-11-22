import {
  processesLimits,
  processRow,
  type ProcessRow,
  type WorkspaceRef,
} from "../../shared/bridge-contract.ts";
import { BridgeFailure, type BridgeHandlers, type BridgeOwner } from "../bridge/registry.ts";
import { type ListeningPort, readListeningPorts } from "../platform/listening-ports.ts";
import { type ProcessEntry, readCommands, readProcessTable } from "../platform/process-table.ts";
import { endSubtree, StopNotConfirmed, StopRefused } from "../platform/process-tree.ts";
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
  readCommandLines?: (
    entries: readonly Pick<ProcessEntry, "pid" | "started">[],
  ) => Promise<Map<number, string>>;
  end?: (target: ProcessEntry) => Promise<void>;
  now?: () => number;
  home?: string;
}

interface Snapshot {
  readonly at: number;
  readonly rows: readonly { readonly owner: BridgeOwner; readonly row: ProcessRow }[];
  readonly more: readonly {
    readonly owner: BridgeOwner;
    readonly workspace: WorkspaceRef;
    readonly count: number;
  }[];
}

const tableReuseMs = 2000;
const refusalReuseMs = 1000;
const unreadableSentence = "Satellite couldn't read the running processes, so it stopped nothing.";
const unlistedSentence =
  "Satellite couldn't read the running processes. The list shows what it read last.";
const unconfirmedSentence = "Satellite couldn't confirm that the process stopped. Check the list.";

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
  commands: ReadonlyMap<number, string>,
  home: string,
): ProcessRow | undefined {
  const { entry, root, subtree } = owned;
  const full = commands.get(entry.pid);
  const command = shownCommand(full === undefined || full === "" ? entry.command : full, home);
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
  readCommandLines = readCommands,
  end = endSubtree,
  now = Date.now,
  home = userHomeFolder(),
}: ProcessesOptions): Processes {
  let reading: Promise<Snapshot> | undefined;
  let finished: { readonly snapshot: Snapshot; readonly at: number } | undefined;
  let generation = 0;
  let stopping = false;
  let recent: { readonly table: readonly ProcessEntry[]; readonly at: number } | undefined;

  const read = async (): Promise<Snapshot> => {
    const at = now();
    const running = roots();
    if (running.length === 0) return { at, rows: [], more: [] };
    const table = await readTable();
    if (table.length === 0) throw new BridgeFailure("failed", unlistedSentence);
    const { owned: listed, more } = listedProcesses(
      table,
      running.map(({ root }) => root),
      at,
      processesLimits.rows,
    );
    if (listed.length === 0) return { at, rows: [], more: [] };
    const [ports, commands] = await Promise.all([
      readPorts(listed.flatMap(({ subtree }) => subtree.map(({ pid }) => pid))),
      readCommandLines(listed.map(({ entry }) => entry)),
    ]);
    const rows = listed.flatMap((owned) => {
      const row = rowOf(owned, ports, commands, home);
      const owner = running.find(({ root }) => root === owned.root)?.owner;
      return row === undefined || owner === undefined ? [] : [{ owner, row }];
    });
    const owners = more.flatMap(({ workspace, count }) => {
      const owner = running.find(
        ({ root }) =>
          root.workspace.projectId === workspace.projectId &&
          root.workspace.workspace === workspace.workspace,
      )?.owner;
      return owner === undefined
        ? []
        : [{ owner, workspace, count: Math.min(count, processesLimits.more) }];
    });
    return { at, rows, more: owners };
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
        if (reading === current) reading = undefined;
      });
    reading = current;
    return current;
  };

  const dropRead = () => {
    generation += 1;
    finished = undefined;
    reading = undefined;
  };

  return {
    handlers: {
      "processes.list": async (_request, owner) => {
        const { at, rows, more } = await snapshot();
        return {
          at,
          rows: rows.filter((candidate) => candidate.owner === owner).map(({ row }) => row),
          more: more
            .filter((candidate) => candidate.owner === owner)
            .map(({ workspace, count }) => ({ workspace, count })),
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
        if (
          recent !== undefined &&
          now() - recent.at < refusalReuseMs &&
          ownedProcess(recent.table, own, pid, started, now()) === undefined
        ) {
          throw new BridgeFailure("not-found", "That process already ended.");
        }
        stopping = true;
        try {
          const table = await readTable();
          if (table.length === 0) {
            throw new BridgeFailure("failed", unreadableSentence);
          }
          recent = { table, at: now() };
          const owned = ownedProcess(table, own, pid, started, now());
          if (owned === undefined) {
            throw new BridgeFailure("not-found", "That process already ended.");
          }
          try {
            await end(owned.entry);
          } catch (error) {
            if (error instanceof StopRefused) {
              throw new BridgeFailure("failed", unreadableSentence);
            }
            if (error instanceof StopNotConfirmed) {
              throw new BridgeFailure("failed", unconfirmedSentence);
            }
            throw error;
          } finally {
            dropRead();
          }
          return {};
        } finally {
          stopping = false;
        }
      },
    },
  };
}

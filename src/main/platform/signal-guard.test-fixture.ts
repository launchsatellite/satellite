import { vi } from "vitest";
import type { Delivery, Prepare } from "./process-tree.ts";

export interface SignalGuard {
  readonly strays: number[];
  own: (...pids: number[]) => void;
  owns: (pid: number) => boolean;
  prepare: Prepare;
  cleanUp: (pid: number) => void;
  restore: () => void;
}

export function guardSignals(extra: () => Iterable<number> = () => []): SignalGuard {
  const owned = new Set<number>();
  const strays: number[] = [];
  const kill = process.kill.bind(process);
  const owns = (pid: number) => {
    const id = Math.abs(pid);
    return id > 1 && id !== process.pid && (owned.has(id) || [...extra()].includes(id));
  };
  const spy = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    if (signal === 0 || owns(pid)) return kill(pid, signal);
    strays.push(pid);
    throw Object.assign(new Error(`a test signalled ${String(pid)}, which it did not start`), {
      code: "EPERM",
    });
  });
  const prepare: Prepare = (members) => {
    const delivery: Delivery = {
      ready: true,
      starts: new Map(),
      send: (name) => {
        const foreign = members.filter((member) => !owns(member.pid));
        if (foreign.length > 0) {
          strays.push(...foreign.map((member) => member.pid));
          return Promise.reject(new Error("a stop reached a process the test did not start"));
        }
        for (const member of members) kill(member.pid, name);
        return Promise.resolve();
      },
    };
    return Promise.resolve(delivery);
  };
  return {
    strays,
    own: (...pids) => {
      for (const pid of pids) owned.add(pid);
    },
    owns,
    prepare,
    cleanUp: (pid) => {
      if (pid <= 1 || pid === process.pid) return;
      try {
        kill(pid, "SIGKILL");
      } catch {
        return;
      }
    },
    restore: () => {
      spy.mockRestore();
    },
  };
}

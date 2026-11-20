import type { BridgeEventName } from "../../shared/bridge-contract.ts";
import type { BridgeOwner } from "./registry.ts";

export interface PageOwners<K extends object> {
  ownerFor(page: K): BridgeOwner;
  end(page: K): void;
}

interface PageLoad {
  readonly owner: BridgeOwner;
  end(): void;
}

function openPageLoad(
  id: number,
  send: (event: BridgeEventName, payload: unknown) => void,
): PageLoad {
  let alive = true;
  let listeners: (() => void)[] = [];
  return {
    owner: {
      id,
      emit(event, payload) {
        if (alive) send(event, payload);
      },
      onGone(listener) {
        if (alive) listeners.push(listener);
        else listener();
      },
    },
    end() {
      if (!alive) return;
      alive = false;
      const ending = listeners;
      listeners = [];
      for (const listener of ending) listener();
    },
  };
}

export function createPageOwners<K extends object>(
  send: (page: K, event: BridgeEventName, payload: unknown) => void,
): PageOwners<K> {
  const loads = new WeakMap<K, PageLoad>();
  let nextId = 1;
  return {
    ownerFor(page) {
      const known = loads.get(page);
      if (known !== undefined) return known.owner;
      const load = openPageLoad(nextId++, (event, payload) => {
        send(page, event, payload);
      });
      loads.set(page, load);
      return load.owner;
    },
    end(page) {
      loads.get(page)?.end();
      loads.delete(page);
    },
  };
}

import { useCallback, useRef, useState } from "react";
import type { InterfaceState } from "../../shared/bridge-contract.ts";
import { invoke } from "../bridge/bridge-client.ts";
import type { Notify } from "../ui/toast.tsx";

type Change = InterfaceState | ((current: InterfaceState) => InterfaceState);

export function useInterfaceState(
  initial: InterfaceState,
  notify: Notify,
): {
  state: InterfaceState;
  update: (change: Change, persist: boolean) => void;
} {
  const [state, setState] = useState(initial);
  const latest = useRef(initial);
  const update = useCallback(
    (change: Change, persist: boolean) => {
      const next = typeof change === "function" ? change(latest.current) : change;
      latest.current = next;
      setState(next);
      if (!persist) return;
      void invoke("interface.save", { state: next }).then((result) => {
        if (!result.ok) notify(result.error.message, "error");
      });
    },
    [notify],
  );
  return { state, update };
}

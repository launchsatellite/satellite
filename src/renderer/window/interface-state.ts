import { useCallback, useState } from "react";
import type { InterfaceState } from "../../shared/bridge-contract.ts";
import { invoke } from "../bridge/bridge-client.ts";

export function useInterfaceState(initial: InterfaceState): {
  state: InterfaceState;
  update: (next: InterfaceState, persist: boolean) => void;
} {
  const [state, setState] = useState(initial);
  const update = useCallback((next: InterfaceState, persist: boolean) => {
    setState(next);
    if (!persist) return;
    void invoke("interface.save", { state: next }).then((result) => {
      if (!result.ok) console.warn(result.error.message);
    });
  }, []);
  return { state, update };
}

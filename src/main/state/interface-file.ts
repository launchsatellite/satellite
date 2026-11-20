import { join } from "node:path";
import { z } from "zod";
import {
  defaultInterfaceState,
  interfaceState,
  type InterfaceState,
  type ThemeChoice,
} from "../../shared/bridge-contract.ts";
import { BridgeFailure, type BridgeHandlers } from "../bridge/registry.ts";
import { createJsonWriter, readJsonFile, type JsonReadOutcome } from "./json-file.ts";

export interface InterfaceFile {
  load(): Promise<{ state: InterfaceState; notice: string | null }>;
  save(state: InterfaceState): Promise<void>;
  flush(): Promise<void>;
}
interface LoadedInterface {
  state: InterfaceState;
  notice: string | null;
  writable: boolean;
}

const fileSchema = interfaceState.extend({ version: z.literal(1) });
const notices: Record<JsonReadOutcome["kind"], string | null> = {
  read: null,
  missing: null,
  "set-aside":
    "Satellite couldn't read its saved layout, so it set that file aside and started fresh.",
  "not-moved":
    "Satellite couldn't read its saved layout or move it aside, so it started fresh and won't save layout changes for now.",
  "not-read":
    "Satellite couldn't open its saved layout, so it started fresh, left the file as it is and won't save layout changes for now.",
};
const saveFailure =
  "Satellite couldn't save the layout. It keeps working and saves again on the next change.";

async function readInterfaceFile(file: string): Promise<LoadedInterface> {
  const { value, outcome } = await readJsonFile(file, fileSchema, {
    ...defaultInterfaceState,
    version: 1,
  });
  return {
    state: { selected: value.selected, columns: value.columns, theme: value.theme },
    notice: notices[outcome.kind],
    writable: outcome.kind !== "not-moved" && outcome.kind !== "not-read",
  };
}

export function createInterfaceFile(home: string): InterfaceFile {
  const file = join(home, "interface.json");
  const writer = createJsonWriter(file);
  let cached: Promise<LoadedInterface> | undefined;
  const load = () => {
    cached ??= readInterfaceFile(file);
    return cached;
  };
  return {
    async load() {
      const { state, notice } = await load();
      return { state, notice };
    },
    async save(state) {
      const loaded = await load();
      cached = Promise.resolve({ ...loaded, state });
      if (loaded.writable) await writer.write({ version: 1, ...state });
    },
    flush: () => writer.flush(),
  };
}

export function interfaceHandlers(
  file: InterfaceFile,
  applyTheme: (theme: ThemeChoice) => void,
): Pick<BridgeHandlers, "interface.load" | "interface.save"> {
  let noticeGiven = false;
  return {
    "interface.load": async () => {
      const { state, notice } = await file.load();
      const answer = { state, notice: noticeGiven ? null : notice };
      noticeGiven = true;
      return answer;
    },
    "interface.save": async ({ state }) => {
      applyTheme(state.theme);
      try {
        await file.save(state);
      } catch (error) {
        console.error("Satellite could not write interface.json", error);
        throw new BridgeFailure("failed", saveFailure);
      }
      return {};
    },
  };
}

import { join } from "node:path";
import { z } from "zod";
import {
  defaultInterfaceState,
  interfaceState,
  type InterfaceState,
  type ThemeChoice,
} from "../../shared/bridge-contract.ts";
import { BridgeFailure, type BridgeHandlers } from "../bridge/registry.ts";
import { createJsonWriter, readJsonFile } from "./json-file.ts";

export interface InterfaceFile {
  load(): Promise<{ state: InterfaceState; notice: string | null }>;
  save(state: InterfaceState): Promise<void>;
}

const fileSchema = interfaceState.extend({ version: z.literal(1) });
const setAsideNotice =
  "Satellite couldn't read its saved layout, so it set that file aside and started fresh.";
const saveFailure =
  "Satellite couldn't save the layout. It keeps working and saves again on the next change.";

async function readInterfaceFile(
  file: string,
): Promise<{ state: InterfaceState; notice: string | null }> {
  const { value, setAside } = await readJsonFile(file, fileSchema, {
    ...defaultInterfaceState,
    version: 1,
  });
  return {
    state: { selected: value.selected, columns: value.columns, theme: value.theme },
    notice: setAside === undefined ? null : setAsideNotice,
  };
}

export function createInterfaceFile(home: string): InterfaceFile {
  const file = join(home, "interface.json");
  const write = createJsonWriter(file);
  let cached: Promise<{ state: InterfaceState; notice: string | null }> | undefined;
  const load = () => {
    cached ??= readInterfaceFile(file);
    return cached;
  };
  return {
    load,
    async save(state) {
      const { notice } = await load();
      cached = Promise.resolve({ state, notice });
      await write({ version: 1, ...state });
    },
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

import { join } from "node:path";
import { z } from "zod";
import {
  defaultInterfaceState,
  filesLimits,
  interfaceState,
  type FileTabs,
  type InterfaceState,
} from "../../shared/bridge-contract.ts";
import { isChangePath } from "../changes/file-sides.ts";
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

const version3 = interfaceState.extend({ version: z.literal(3) });
const version2 = interfaceState
  .omit({ files: true })
  .extend({ version: z.literal(2) })
  .transform((file): z.output<typeof version3> => ({ ...file, version: 3, files: [] }));
const version1 = interfaceState
  .omit({ notifications: true, files: true })
  .extend({ version: z.literal(1) })
  .transform((file): z.output<typeof version3> => ({
    ...file,
    version: 3,
    notifications: true,
    files: [],
  }));
const fileSchema = z.union([version1, version2, version3]);
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
    version: 3,
  });
  return {
    state: {
      selected: value.selected,
      columns: value.columns,
      theme: value.theme,
      notifications: value.notifications,
      files: value.files,
    },
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
      if (loaded.writable) await writer.write({ version: 3, ...state });
    },
    flush: () => writer.flush(),
  };
}

const controlCharacter = /\p{Cc}/u;

function keptPath(path: string): boolean {
  return (
    path.length <= filesLimits.tabPathChars && !controlCharacter.test(path) && isChangePath(path)
  );
}

export function keptTabs(
  tabs: readonly FileTabs[],
  workspaces: ReadonlySet<string> | null,
): FileTabs[] {
  return tabs.flatMap((entry) => {
    if (workspaces?.has(`${entry.projectId}/${entry.workspace}`) === false) return [];
    const paths = entry.paths.filter(keptPath);
    const shown = entry.paths[entry.active];
    const at = shown === undefined ? -1 : paths.indexOf(shown);
    return paths.length === 0 ? [] : [{ ...entry, paths, active: Math.max(at, 0) }];
  });
}

function recordedOrUnknown(
  recorded: () => Promise<ReadonlySet<string>>,
): Promise<ReadonlySet<string> | null> {
  return recorded().catch(() => null);
}

export function interfaceHandlers(
  file: InterfaceFile,
  apply: (state: InterfaceState) => void,
  recorded: () => Promise<ReadonlySet<string>>,
): Pick<BridgeHandlers, "interface.load" | "interface.save"> {
  let noticeGiven = false;
  let saving: Promise<unknown> = Promise.resolve();
  let lastTabs: { asked: string; kept: FileTabs[] } | undefined;
  const filesOf = async (tabs: FileTabs[]): Promise<FileTabs[]> => {
    const asked = JSON.stringify(tabs);
    if (lastTabs?.asked === asked) return lastTabs.kept;
    const known = await recordedOrUnknown(recorded);
    const kept = keptTabs(tabs, known);
    if (known !== null) lastTabs = { asked, kept };
    return kept;
  };
  const saved = async (state: InterfaceState) => {
    const kept = { ...state, files: await filesOf(state.files) };
    apply(kept);
    try {
      await file.save(kept);
    } catch (error) {
      console.error("Satellite could not write interface.json", error);
      throw new BridgeFailure("failed", saveFailure);
    }
    return {};
  };
  return {
    "interface.load": async () => {
      const { state, notice } = await file.load();
      const answer = {
        state: { ...state, files: keptTabs(state.files, await recordedOrUnknown(recorded)) },
        notice: noticeGiven ? null : notice,
      };
      noticeGiven = true;
      return answer;
    },
    "interface.save": ({ state }) => {
      const run = saving.then(() => saved(state));
      saving = run.catch(() => undefined);
      return run;
    },
  };
}

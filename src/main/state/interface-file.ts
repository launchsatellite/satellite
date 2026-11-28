import { join } from "node:path";
import { z } from "zod";
import {
  defaultInterfaceState,
  filesLimits,
  interfaceLimits,
  interfaceState,
  themeChoice,
  type FileTabs,
  type InterfaceState,
} from "../../shared/bridge-contract.ts";
import { isChangePath } from "../changes/file-sides.ts";
import { BridgeFailure, type BridgeHandlers } from "../bridge/registry.ts";
import { createJsonWriter, readJsonFile, type JsonReadOutcome } from "./json-file.ts";

export interface InterfaceFile {
  load(): Promise<{ state: InterfaceState; notice: string | null }>;
  save(state: InterfaceState | (() => Promise<InterfaceState>)): Promise<void>;
  flush(): Promise<void>;
}
interface LoadedInterface {
  state: InterfaceState;
  notice: string | null;
  writable: boolean;
}

const fileVersion = 6;
const storedState = interfaceState.extend({
  theme: z.string().max(100).pipe(themeChoice).catch("system"),
});
const version6 = storedState.extend({ version: z.literal(fileVersion) });
const legacyState = storedState.omit({ rail: true }).extend({
  columns: z.strictObject({
    left: z.int().min(200).max(360),
    right: z.int().min(360).max(640),
  }),
});
const version5 = legacyState.extend({ version: z.literal(5) });
const version4 = legacyState
  .omit({ sidebar: true })
  .extend({ version: z.literal(4) })
  .transform((file): z.output<typeof version5> => ({ ...file, version: 5, sidebar: "shown" }));
const version3 = legacyState
  .omit({ sidebar: true, guideSeen: true })
  .extend({ version: z.literal(3) })
  .transform((file): z.output<typeof version5> => ({
    ...file,
    version: 5,
    sidebar: "shown",
    guideSeen: true,
  }));
const version2 = legacyState
  .omit({ sidebar: true, files: true, guideSeen: true })
  .extend({ version: z.literal(2) })
  .transform((file): z.output<typeof version5> => ({
    ...file,
    version: 5,
    sidebar: "shown",
    files: [],
    guideSeen: true,
  }));
const version1 = legacyState
  .omit({ sidebar: true, notifications: true, files: true, guideSeen: true })
  .extend({ version: z.literal(1) })
  .transform((file): z.output<typeof version5> => ({
    ...file,
    version: 5,
    sidebar: "shown",
    notifications: true,
    files: [],
    guideSeen: true,
  }));
const legacyFile = z
  .union([version1, version2, version3, version4, version5])
  .transform(({ columns, ...file }): z.output<typeof version6> => ({
    ...file,
    version: fileVersion,
    columns: {
      sidebar: clamp(columns.left, interfaceLimits.sidebar),
      rail: clamp(columns.right, interfaceLimits.rail),
    },
    rail: "shown",
  }));
const fileSchema = z.union([version6, legacyFile]);
const notices: Record<JsonReadOutcome["kind"], string | null> = {
  read: null,
  missing: null,
  "set-aside":
    "Satellite couldn't read its saved layout, so it set that file aside and started fresh.",
  "not-moved":
    "Satellite couldn't read its saved layout or move it aside, so it started fresh and won't save layout changes for now.",
  "not-read":
    "Satellite couldn't open its saved layout, so it started fresh, left the file as it is and won't save layout changes for now.",
  newer: null,
};
const saveFailure =
  "Satellite couldn't save the layout. It keeps working and saves again on the next change.";

function clamp(value: number, { min, max }: { min: number; max: number }): number {
  return Math.min(max, Math.max(min, value));
}

async function readInterfaceFile(file: string): Promise<LoadedInterface> {
  const { value, outcome } = await readJsonFile(file, fileSchema, {
    ...defaultInterfaceState,
    version: fileVersion,
  });
  return {
    state: {
      selected: value.selected,
      columns: value.columns,
      sidebar: value.sidebar,
      rail: value.rail,
      theme: value.theme,
      notifications: value.notifications,
      files: value.files,
      guideSeen: outcome.kind === "read" || outcome.kind === "missing" ? value.guideSeen : true,
    },
    notice: notices[outcome.kind],
    writable: outcome.kind !== "not-moved" && outcome.kind !== "not-read",
  };
}

export function createInterfaceFile(home: string): InterfaceFile {
  const file = join(home, "interface.json");
  const writer = createJsonWriter(file);
  let cached: Promise<LoadedInterface> | undefined;
  let saving: Promise<unknown> = Promise.resolve();
  const load = () => {
    cached ??= readInterfaceFile(file).then(async (loaded) => {
      if (loaded.notice !== null && loaded.writable) {
        await writer.write({ version: fileVersion, ...loaded.state }).catch(() => undefined);
      }
      return loaded;
    });
    return cached;
  };
  return {
    async load() {
      const { state, notice } = await load();
      return { state, notice };
    },
    save(next) {
      const run = saving.then(async () => {
        const state = typeof next === "function" ? await next() : next;
        const loaded = await load();
        cached = Promise.resolve({ ...loaded, state });
        if (loaded.writable) await writer.write({ version: fileVersion, ...state });
      });
      saving = run.catch(() => undefined);
      return run;
    },
    async flush() {
      let settled: Promise<unknown> | undefined;
      while (settled !== saving) {
        settled = saving;
        await settled;
      }
      await writer.flush();
    },
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
  let lastTabs: { asked: string; kept: FileTabs[] } | undefined;
  const filesOf = async (tabs: FileTabs[]): Promise<FileTabs[]> => {
    const asked = JSON.stringify(tabs);
    if (lastTabs?.asked === asked) return lastTabs.kept;
    const known = await recordedOrUnknown(recorded);
    const kept = keptTabs(tabs, known);
    if (known !== null) lastTabs = { asked, kept };
    return kept;
  };
  const kept = async (state: InterfaceState) => {
    const next = { ...state, files: await filesOf(state.files) };
    apply(next);
    return next;
  };
  const saved = async (state: InterfaceState) => {
    try {
      await file.save(() => kept(state));
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
    "interface.save": ({ state }) => saved(state),
  };
}

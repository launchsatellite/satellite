import { join } from "node:path";
import { z } from "zod";
import { workspaceKey, type WorkspaceRef } from "../../shared/bridge-contract.ts";
import { createJsonWriter, readJsonFile } from "../state/json-file.ts";

export interface LastSessions {
  get(ref: WorkspaceRef): Promise<string | undefined>;
  set(ref: WorkspaceRef, sessionId: string): Promise<void>;
  forget(ref: WorkspaceRef, sessionId: string): Promise<void>;
  keepOnly(recorded: readonly WorkspaceRef[]): Promise<void>;
  flush(): Promise<void>;
}
type Entry = z.output<typeof entrySchema>;
interface Loaded {
  last: Entry[];
  writable: boolean;
}

const entryLimit = 4200;
const entrySchema = z.strictObject({
  projectId: z.uuid(),
  workspace: workspaceKey,
  sessionId: z.uuid(),
});
const fileSchema = z
  .strictObject({ version: z.literal(1), last: z.array(entrySchema).max(entryLimit) })
  .refine(({ last }) => new Set(last.map(pairOf)).size === last.length);

function pairOf(ref: WorkspaceRef): string {
  return `${ref.projectId}/${ref.workspace}`;
}

async function readLastSessions(file: string): Promise<Loaded> {
  const { value, outcome } = await readJsonFile(file, fileSchema, { version: 1, last: [] });
  if (outcome.kind !== "read" && outcome.kind !== "missing") {
    console.error(
      `sessions.json could not be read (${outcome.kind}), so no session is offered to resume`,
    );
  }
  return {
    last: value.last,
    writable: outcome.kind !== "not-moved" && outcome.kind !== "not-read",
  };
}

export function createLastSessions(home: string): LastSessions {
  const file = join(home, "sessions.json");
  const writer = createJsonWriter(file);
  let cached: Promise<Loaded> | undefined;
  const load = () => {
    cached ??= readLastSessions(file);
    return cached;
  };
  let changes: Promise<void> = Promise.resolve();
  const apply = async (change: (last: Entry[]) => Entry[] | undefined) => {
    const loaded = await load();
    const last = change(loaded.last);
    if (last === undefined) return;
    cached = Promise.resolve({ ...loaded, last });
    if (!loaded.writable) return;
    await writer.write({ version: 1, last }).catch((error: unknown) => {
      console.error("sessions.json could not be saved", error);
    });
  };
  const save = (change: (last: Entry[]) => Entry[] | undefined) => {
    changes = changes
      .then(() => apply(change))
      .catch((error: unknown) => {
        console.error("sessions.json could not be changed", error);
      });
    return changes;
  };
  return {
    async get(ref) {
      const pair = pairOf(ref);
      return (await load()).last.find((entry) => pairOf(entry) === pair)?.sessionId;
    },
    async set(ref, sessionId) {
      const parsed = entrySchema.safeParse({ ...ref, sessionId });
      if (!parsed.success) return;
      const entry = parsed.data;
      await save((last) => {
        const pair = pairOf(entry);
        if (last.some((kept) => pairOf(kept) === pair && kept.sessionId === sessionId)) {
          return undefined;
        }
        return [...last.filter((kept) => pairOf(kept) !== pair), entry].slice(-entryLimit);
      });
    },
    async forget(ref, sessionId) {
      const pair = pairOf(ref);
      await save((last) => {
        const kept = last.filter(
          (entry) => pairOf(entry) !== pair || entry.sessionId !== sessionId,
        );
        return kept.length === last.length ? undefined : kept;
      });
    },
    async keepOnly(recorded) {
      const pairs = new Set(recorded.map(pairOf));
      await save((last) => {
        const kept = last.filter((entry) => pairs.has(pairOf(entry)));
        return kept.length === last.length ? undefined : kept;
      });
    },
    async flush() {
      await changes;
      await writer.flush();
    },
  };
}

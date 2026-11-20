import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { z } from "zod";

const standInEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("start"),
    tool: z.enum(["claude", "gh"]),
    pid: z.int(),
    args: z.array(z.string()),
  }),
  z.strictObject({ type: z.literal("input"), data: z.string() }),
  z.strictObject({ type: z.literal("resize"), cols: z.int(), rows: z.int() }),
  z.strictObject({ type: z.literal("child"), pid: z.int() }),
]);

export type StandInEvent = z.infer<typeof standInEventSchema>;

export function appendStandInEvent(event: StandInEvent): void {
  const log = process.env["SATELLITE_VERIFY_LOG"];
  if (log === undefined || log === "") throw new Error("SATELLITE_VERIFY_LOG is not set");
  appendFileSync(log, `${JSON.stringify(event)}\n`);
}

export async function readStandInEvents(file: string): Promise<StandInEvent[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => standInEventSchema.parse(JSON.parse(line)));
}

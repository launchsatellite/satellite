import { setTimeout as delay } from "node:timers/promises";

export interface QuitParts {
  changes: { stopAll(): Promise<void> };
  files: { stopAll(): Promise<void> };
  notices: { stop(): void };
  terminals: { closeAll(): Promise<void> };
  last: { flush(): Promise<void> };
  interfaceFile: { flush(): Promise<void> };
  workspaces: { stopAll(): Promise<void> };
  projects: { flush(): Promise<void> };
  recorder: { flush(): Promise<void> };
}

export async function settleForQuit(parts: QuitParts | undefined, boundMs: number): Promise<void> {
  if (parts === undefined) return;
  parts.notices.stop();
  const bounded = (work: Promise<unknown>) => Promise.race([work, delay(boundMs)]);
  await Promise.all([
    bounded(
      Promise.all([
        parts.terminals.closeAll().then(() => parts.recorder.flush()),
        parts.last.flush(),
        parts.interfaceFile.flush(),
      ]),
    ),
    parts.workspaces.stopAll().then(() => bounded(parts.projects.flush())),
    bounded(parts.changes.stopAll()),
    bounded(parts.files.stopAll()),
  ]);
}

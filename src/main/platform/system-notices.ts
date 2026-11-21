import { appendFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { Notification, app } from "electron";
import { bridgeLimits } from "../../shared/bridge-contract.ts";
import type { NoticeText } from "../inbox/notice-text.ts";
import type { ShownNotice } from "../inbox/notices.ts";
import { drivenByVerify } from "../window/verification.ts";

type RecordedLine =
  | { kind: "notice"; title: string; body: string }
  | { kind: "close" }
  | { kind: "badge"; count: number };

export const appUserModelId = "app.satellite.desktop";

let recorder: { file: string | undefined } | undefined;
let recording = Promise.resolve();
const logged = new Set<string>();

function logOnce(message: string, error?: unknown): void {
  if (logged.has(message)) return;
  logged.add(message);
  if (error === undefined) console.error(message);
  else console.error(message, error);
}

function recordFile(): string | undefined {
  if (recorder === undefined) {
    const file = process.env["SATELLITE_VERIFY_NOTICES"];
    recorder = {
      file: file !== undefined && isAbsolute(file) && drivenByVerify() ? file : undefined,
    };
  }
  return recorder.file;
}

function record(file: string, line: RecordedLine): void {
  recording = recording
    .then(() => appendFile(file, `${JSON.stringify(line)}\n`))
    .catch((error: unknown) => {
      logOnce("Satellite could not record a notification", error);
    });
}

function clampedCount(count: number): number {
  return Number.isFinite(count)
    ? Math.min(Math.max(Math.trunc(count), 0), bridgeLimits.terminals)
    : 0;
}

function showSystemNotice(
  { title, body }: NoticeText,
  onClick: () => void,
): ShownNotice | undefined {
  if (!Notification.isSupported()) {
    logOnce("This system shows no notifications");
    return undefined;
  }
  const notice = new Notification({ title, body });
  notice.on("click", onClick);
  notice.on("failed", (_event, error) => {
    logOnce("The system refused a notification", error);
  });
  notice.show();
  return {
    close: () => {
      try {
        notice.close();
      } catch (error) {
        logOnce("The system could not close a notification", error);
      }
    },
  };
}

export function recordedLines(): Promise<void> {
  return recording;
}

export function noticesRecorded(): boolean {
  return recordFile() !== undefined;
}

export function windowCountsInFront(inFront: () => boolean): boolean {
  return !noticesRecorded() && inFront();
}

export function windowTookFocus(seen: () => void): void {
  if (!noticesRecorded()) seen();
}

export function prepareSystemNotices(): void {
  if (process.platform === "win32") app.setAppUserModelId(appUserModelId);
  if (process.platform === "linux" || noticesRecorded()) setAppBadge(0);
}

export function showNotice(text: NoticeText, onClick: () => void): ShownNotice | undefined {
  const file = recordFile();
  if (file !== undefined) {
    record(file, { kind: "notice", title: text.title, body: text.body });
    return {
      close: () => {
        record(file, { kind: "close" });
      },
    };
  }
  try {
    return showSystemNotice(text, onClick);
  } catch (error) {
    logOnce("The system refused a notification", error);
    return undefined;
  }
}

export function setAppBadge(count: number): void {
  const shown = clampedCount(count);
  const file = recordFile();
  if (file !== undefined) {
    record(file, { kind: "badge", count: shown });
    return;
  }
  if (process.platform === "win32") return;
  try {
    app.setBadgeCount(shown);
  } catch (error) {
    logOnce("The system could not show the count on the app icon", error);
  }
}

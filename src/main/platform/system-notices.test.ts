import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => {
  class FakeNotification {
    static supported = true;
    static throws = false;
    static made: FakeNotification[] = [];
    static isSupported() {
      return FakeNotification.supported;
    }
    readonly listeners = new Map<string, (...args: unknown[]) => void>();
    readonly show = vi.fn();
    readonly close = vi.fn();
    readonly options: { title: string; body: string };
    constructor(options: { title: string; body: string }) {
      this.options = options;
      if (FakeNotification.throws) throw new Error("no notification server");
      FakeNotification.made.push(this);
    }
    on(event: string, listener: (...args: unknown[]) => void) {
      this.listeners.set(event, listener);
      return this;
    }
  }
  return {
    FakeNotification,
    app: { setBadgeCount: vi.fn(() => true), setAppUserModelId: vi.fn() },
    driven: { live: true },
  };
});

vi.mock("electron", () => ({ Notification: fakes.FakeNotification, app: fakes.app }));
vi.mock("../window/verification.ts", () => ({ drivenByVerify: () => fakes.driven.live }));

const realPlatform = process.platform;
const text = { title: "alpha needs you", body: "Claude Code is waiting for you in repo." };

function onPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform });
}

async function freshModule() {
  vi.resetModules();
  return import("./system-notices.ts");
}

async function lines(file: string): Promise<unknown[]> {
  await vi.waitFor(async () => {
    expect(await readFile(file, "utf8")).toMatch(/\n$/);
  });
  const read = await readFile(file, "utf8");
  return read
    .split("\n")
    .filter((line) => line !== "")
    .map((line): unknown => JSON.parse(line));
}

describe("system notices", () => {
  beforeEach(() => {
    fakes.FakeNotification.supported = true;
    fakes.FakeNotification.throws = false;
    fakes.FakeNotification.made = [];
    fakes.driven.live = true;
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    onPlatform("darwin");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    onPlatform(realPlatform);
  });

  it("records a clear count at start, then instead of showing or counting while the driver is live", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "satellite-notices-")), "notices.jsonl");
    vi.stubEnv("SATELLITE_VERIFY_NOTICES", file);
    const notices = await freshModule();
    expect(notices.noticesRecorded()).toBe(true);
    notices.prepareSystemNotices();
    notices.setAppBadge(1);
    notices.showNotice(text, vi.fn())?.close();
    notices.setAppBadge(0);
    await vi.waitFor(async () => {
      expect(await lines(file)).toHaveLength(5);
    });
    expect(await lines(file)).toEqual([
      { kind: "badge", count: 0 },
      { kind: "badge", count: 1 },
      { kind: "notice", ...text },
      { kind: "close" },
      { kind: "badge", count: 0 },
    ]);
    expect(fakes.FakeNotification.made).toEqual([]);
    expect(fakes.app.setBadgeCount).not.toHaveBeenCalled();
  });

  it("never counts the window as in front or seen while recording", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "satellite-notices-")), "notices.jsonl");
    vi.stubEnv("SATELLITE_VERIFY_NOTICES", file);
    const recording = await freshModule();
    const seen = vi.fn();
    expect(recording.windowCountsInFront(() => true)).toBe(false);
    recording.windowTookFocus(seen);
    expect(seen).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    const real = await freshModule();
    expect(real.windowCountsInFront(() => true)).toBe(true);
    expect(real.windowCountsInFront(() => false)).toBe(false);
    real.windowTookFocus(seen);
    expect(seen).toHaveBeenCalledOnce();
  });

  it("never lets a leftover variable or a relative path swallow notifications", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "satellite-notices-")), "notices.jsonl");
    vi.stubEnv("SATELLITE_VERIFY_NOTICES", file);
    fakes.driven.live = false;
    const leftover = await freshModule();
    expect(leftover.noticesRecorded()).toBe(false);
    leftover.showNotice(text, vi.fn());
    expect(fakes.FakeNotification.made).toHaveLength(1);
    vi.stubEnv("SATELLITE_VERIFY_NOTICES", "notices.jsonl");
    fakes.driven.live = true;
    const relative = await freshModule();
    expect(relative.noticesRecorded()).toBe(false);
    await expect(readFile(file, "utf8")).rejects.toThrow();
  });

  it("shows only Satellite's words and opens on a click", async () => {
    const notices = await freshModule();
    const onClick = vi.fn();
    const shown = notices.showNotice(text, onClick);
    const [made] = fakes.FakeNotification.made;
    expect(made?.options).toEqual(text);
    expect(made?.show).toHaveBeenCalledTimes(1);
    made?.listeners.get("click")?.({});
    expect(onClick).toHaveBeenCalledTimes(1);
    shown?.close();
    expect(made?.close).toHaveBeenCalledTimes(1);
  });

  it("never throws or retries when the system cannot show a notification, and logs it once", async () => {
    const notices = await freshModule();
    fakes.FakeNotification.supported = false;
    expect(notices.showNotice(text, vi.fn())).toBeUndefined();
    expect(notices.showNotice(text, vi.fn())).toBeUndefined();
    expect(fakes.FakeNotification.made).toEqual([]);
    fakes.FakeNotification.supported = true;
    fakes.FakeNotification.throws = true;
    expect(notices.showNotice(text, vi.fn())).toBeUndefined();
    expect(notices.showNotice(text, vi.fn())).toBeUndefined();
    fakes.FakeNotification.throws = false;
    notices.showNotice(text, vi.fn());
    notices.showNotice(text, vi.fn());
    for (const made of fakes.FakeNotification.made) {
      made.listeners.get("failed")?.({}, "not signed");
    }
    expect(fakes.FakeNotification.made.map((made) => made.show.mock.calls.length)).toEqual([1, 1]);
    expect(vi.mocked(console.error).mock.calls.map((call) => String(call[0]))).toEqual([
      "This system shows no notifications",
      "The system refused a notification",
    ]);
  });

  it("clamps the count, shows none on Windows and gives Windows the installer's identity", async () => {
    const notices = await freshModule();
    notices.setAppBadge(40);
    notices.setAppBadge(-2);
    notices.setAppBadge(Number.NaN);
    expect(fakes.app.setBadgeCount.mock.calls).toEqual([[16], [0], [0]]);
    fakes.app.setBadgeCount.mockImplementation(() => {
      throw new Error("no dock");
    });
    expect(() => {
      notices.setAppBadge(1);
    }).not.toThrow();
    fakes.app.setBadgeCount.mockClear();
    onPlatform("win32");
    notices.setAppBadge(3);
    notices.prepareSystemNotices();
    expect(fakes.app.setBadgeCount).not.toHaveBeenCalled();
    expect(fakes.app.setAppUserModelId).toHaveBeenCalledWith("app.satellite.desktop");
    onPlatform("linux");
    notices.prepareSystemNotices();
    expect(fakes.app.setBadgeCount).toHaveBeenCalledWith(0);
  });
});

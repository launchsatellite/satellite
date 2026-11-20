import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceRef } from "../../shared/bridge-contract.ts";
import type { BridgeOwner } from "../bridge/registry.ts";
import type { NoticeSubject, NoticeText } from "./notice-text.ts";
import { createNotices, noticeGapMs, type Needing } from "./notices.ts";

interface Shown {
  text: NoticeText;
  click: () => void;
  close: ReturnType<typeof vi.fn>;
}

const projectId = "4f9c2a1e-7b3d-4c8a-9e21-5d6f0a1b2c3d";
const owner = (id: number): BridgeOwner => ({
  id,
  emit: () => undefined,
  onGone: () => undefined,
});
const ref = (name: string): WorkspaceRef => ({
  projectId,
  workspace: name === "main" ? "main" : `00000000-0000-4000-8000-${name.padStart(12, "0")}`,
});
const need = (name: string, page = 1): Needing => ({ workspace: ref(name), owner: owner(page) });
const nameOf = (workspace: WorkspaceRef) =>
  workspace.workspace === "main" ? "main" : workspace.workspace.slice(-12).replace(/^0+/, "");

function setup() {
  const state = {
    front: false,
    gone: new Set<string>(),
    failing: new Set<string>(),
    slow: new Map<string, number>(),
  };
  const shown: Shown[] = [];
  const badges: number[] = [];
  const opened: Needing[] = [];
  const subject = vi.fn(async (workspace: WorkspaceRef): Promise<NoticeSubject | undefined> => {
    const name = nameOf(workspace);
    const slow = state.slow.get(name);
    await (slow === undefined
      ? Promise.resolve()
      : new Promise((resolve) => setTimeout(resolve, slow)));
    if (state.failing.has(name)) throw new Error("projects.json could not be read");
    if (state.gone.has(name)) return undefined;
    return { project: "repo", workspace: name === "main" ? null : `w${name}` };
  });
  const notices = createNotices({
    inFront: () => state.front,
    subject,
    show: (text, click) => {
      const close = vi.fn();
      shown.push({ text, click, close });
      return { close };
    },
    setBadge: (count) => badges.push(count),
    open: (target) => opened.push(target),
  });
  return { state, shown, badges, opened, subject, notices };
}

const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createNotices", () => {
  it("notifies once when a workspace starts needing you", async () => {
    const { shown, badges, notices } = setup();
    notices.update([]);
    notices.update([need("1")]);
    await settle();
    expect(shown.map(({ text }) => text)).toEqual([
      { title: "w1 needs you", body: "Claude Code is waiting for you in repo." },
    ]);
    expect(badges).toEqual([1]);
  });

  it("does not notify again while the workspace still needs you", async () => {
    const { shown, badges, notices } = setup();
    notices.update([need("1")]);
    await settle(noticeGapMs * 2);
    notices.update([need("1")]);
    notices.update([need("1"), need("1", 2)]);
    notices.update([need("1", 2), need("1")]);
    await settle(noticeGapMs * 2);
    expect(shown).toHaveLength(1);
    expect(badges).toEqual([1]);
  });

  it("notifies again after the workspace was answered", async () => {
    const { shown, badges, notices } = setup();
    notices.update([need("1")]);
    await settle();
    notices.update([]);
    await settle(noticeGapMs);
    notices.update([need("1")]);
    await settle();
    expect(shown).toHaveLength(2);
    expect(badges).toEqual([1, 0, 1]);
  });

  it("stays quiet while the window is in front or notifications are off", async () => {
    const { state, shown, badges, notices } = setup();
    state.front = true;
    notices.update([need("1")]);
    await settle(noticeGapMs);
    state.front = false;
    notices.setEnabled(false);
    notices.update([need("1"), need("2")]);
    await settle(noticeGapMs);
    notices.update([]);
    expect(shown).toEqual([]);
    expect(badges).toEqual([1, 2, 0]);
  });

  it("gathers a burst into one notification", async () => {
    const { shown, opened, notices } = setup();
    const burst = ["1", "2", "3", "4", "5"].map((name) => need(name));
    notices.update(burst);
    await settle(noticeGapMs * 2);
    expect(shown.map(({ text }) => text.title)).toEqual(["5 workspaces need you"]);
    shown[0]?.click();
    expect(opened).toEqual([burst[4]]);
  });

  it("waits out the gap before the next notification", async () => {
    const { shown, opened, notices } = setup();
    notices.update([need("1")]);
    await settle(2000);
    notices.update([need("1"), need("2")]);
    await settle(1000);
    notices.update([need("1"), need("2"), need("3")]);
    await settle(1000);
    notices.update([need("1"), need("2")]);
    await settle(noticeGapMs - 4001);
    expect(shown).toHaveLength(1);
    await settle(1);
    expect(shown.map(({ text }) => text.title)).toEqual(["w1 needs you", "w2 needs you"]);
    expect(shown[0]?.close).toHaveBeenCalledTimes(1);
    shown[1]?.click();
    expect(opened.map(({ workspace }) => nameOf(workspace))).toEqual(["2"]);
  });

  it("does not hold back the next notification for a wait that was answered", async () => {
    const { shown, notices } = setup();
    notices.update([need("1")]);
    await settle(1000);
    notices.update([need("1"), need("2")]);
    await settle(1000);
    notices.update([need("1")]);
    await settle(noticeGapMs);
    notices.update([need("1"), need("3")]);
    await settle();
    expect(shown.map(({ text }) => text.title)).toEqual(["w1 needs you", "w3 needs you"]);
  });

  it("closes a notification once everything it named was answered", async () => {
    const { shown, notices } = setup();
    notices.update([need("1"), need("2")]);
    await settle();
    notices.update([need("2"), need("3")]);
    expect(shown[0]?.close).not.toHaveBeenCalled();
    notices.update([need("3")]);
    expect(shown[0]?.close).toHaveBeenCalledTimes(1);
    notices.update([]);
    await settle(noticeGapMs * 2);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.close).toHaveBeenCalledTimes(1);
  });

  it("opens the workspace the notification named on a click", async () => {
    const { shown, opened, notices } = setup();
    const asking = need("main", 3);
    notices.update([asking]);
    await settle();
    expect(shown[0]?.text.title).toBe("repo needs you");
    expect(opened).toEqual([]);
    shown[0]?.click();
    expect(opened).toEqual([asking]);
  });

  it("never announces a need that began while notifications were off", async () => {
    const { shown, notices } = setup();
    notices.setEnabled(false);
    notices.update([need("1")]);
    notices.setEnabled(true);
    notices.update([need("1")]);
    await settle(noticeGapMs * 2);
    expect(shown).toEqual([]);
    notices.update([need("1"), need("2")]);
    await settle();
    expect(shown.map(({ text }) => text.title)).toEqual(["w2 needs you"]);
  });

  it("skips a workspace that is gone by the time it shows", async () => {
    const { state, shown, notices } = setup();
    state.gone = new Set(["1", "2"]);
    notices.update([need("1"), need("2")]);
    await settle(noticeGapMs * 2);
    expect(shown).toEqual([]);
    state.gone = new Set(["1"]);
    notices.update([need("1"), need("2"), need("3")]);
    await settle(noticeGapMs * 2);
    expect(shown.map(({ text }) => text.title)).toEqual(["w3 needs you"]);
  });

  it("never names a workspace answered while its name was looked up", async () => {
    const { shown, notices } = setup();
    notices.update([need("1"), need("2")]);
    notices.update([need("2")]);
    await settle();
    expect(shown.map(({ text }) => text.title)).toEqual(["w2 needs you"]);
    notices.update([]);
    await settle(noticeGapMs);
    notices.update([need("3")]);
    notices.update([]);
    await settle(noticeGapMs * 2);
    expect(shown).toHaveLength(1);
  });

  it("drops what waits once the window comes to the front", async () => {
    const { state, shown, notices } = setup();
    notices.update([need("1")]);
    await settle();
    notices.update([need("1"), need("2")]);
    state.front = true;
    await settle(noticeGapMs * 2);
    state.front = false;
    notices.update([need("1"), need("2")]);
    await settle(noticeGapMs * 2);
    expect(shown).toHaveLength(1);
    notices.update([need("3")]);
    state.front = true;
    await settle(noticeGapMs * 2);
    expect(shown).toHaveLength(1);
  });

  it("shows nothing after turning off with a notification waiting, as when quitting", async () => {
    const { shown, notices } = setup();
    notices.update([need("1")]);
    await settle();
    notices.update([need("1"), need("2")]);
    notices.setEnabled(false);
    notices.setEnabled(true);
    await settle(noticeGapMs * 2);
    notices.update([need("1"), need("3")]);
    notices.setEnabled(false);
    await settle(noticeGapMs * 2);
    expect(shown).toHaveLength(1);
  });

  it("shows nothing when turned off or brought to the front while a name is looked up", async () => {
    const { state, shown, notices } = setup();
    notices.update([need("1")]);
    notices.setEnabled(false);
    await settle(noticeGapMs * 2);
    notices.setEnabled(true);
    notices.update([need("1"), need("2")]);
    state.front = true;
    await settle(noticeGapMs * 2);
    expect(shown).toEqual([]);
  });

  it("logs a failed show once and tries again on the next need", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const show = vi.fn(() => {
      throw new Error("no notification server");
    });
    const notices = createNotices({
      inFront: () => false,
      subject: (workspace) => Promise.resolve({ project: "repo", workspace: nameOf(workspace) }),
      show,
      setBadge: () => undefined,
      open: () => undefined,
    });
    notices.update([need("1")]);
    await settle(noticeGapMs);
    notices.update([need("1"), need("2")]);
    await settle(noticeGapMs);
    expect(show).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toBe("Satellite could not show a notification");
    error.mockRestore();
  });

  it("keeps the gap while a name lookup is slow", async () => {
    const { state, shown, notices } = setup();
    state.slow.set("1", 100);
    notices.update([need("1")]);
    await settle(50);
    notices.update([need("1"), need("2")]);
    await settle(100);
    expect(shown.map(({ text }) => text.title)).toEqual(["w1 needs you"]);
    await settle(noticeGapMs - 151);
    expect(shown).toHaveLength(1);
    await settle(1);
    expect(shown.map(({ text }) => text.title)).toEqual(["w1 needs you", "w2 needs you"]);
  });

  it("never lets a slow lookup close or replace a newer notification", async () => {
    const { state, shown, notices } = setup();
    state.slow.set("1", noticeGapMs * 2);
    notices.update([need("1")]);
    await settle(1);
    notices.update([need("1"), need("2")]);
    await settle(noticeGapMs * 3);
    expect(shown.map(({ text }) => text.title)).toEqual(["w2 needs you"]);
    expect(shown[0]?.close).not.toHaveBeenCalled();
  });

  it("tells the same workspace of two projects apart and opens the first page that asked", async () => {
    const { shown, badges, opened, notices } = setup();
    const otherProject = {
      ...need("main", 2),
      workspace: { ...ref("main"), projectId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" },
    };
    notices.update([need("main"), otherProject]);
    await settle();
    expect(badges).toEqual([2]);
    expect(shown.map(({ text }) => text.title)).toEqual(["2 workspaces need you"]);
    notices.update([]);
    await settle(noticeGapMs);
    const first = need("1", 1);
    notices.update([first, need("1", 2)]);
    await settle();
    shown[1]?.click();
    expect(opened).toEqual([first]);
    expect(opened[0]?.owner.id).toBe(1);
  });

  it("never announces later a need the user saw with the window in front", async () => {
    const { state, shown, notices } = setup();
    notices.update([need("1")]);
    await settle(1000);
    notices.update([need("1"), need("2")]);
    state.front = true;
    notices.seen();
    await settle(1000);
    state.front = false;
    await settle(noticeGapMs * 2);
    expect(shown.map(({ text }) => text.title)).toEqual(["w1 needs you"]);
    notices.update([need("1"), need("2"), need("3")]);
    await settle();
    expect(shown.map(({ text }) => text.title)).toEqual(["w1 needs you", "w3 needs you"]);
  });

  it("does not use up the gap when nothing could be named", async () => {
    const { state, shown, notices } = setup();
    state.gone = new Set(["1"]);
    notices.update([need("1")]);
    await settle(100);
    notices.update([need("1"), need("2")]);
    await settle();
    expect(shown.map(({ text }) => text.title)).toEqual(["w2 needs you"]);
  });

  it("tries a lookup that failed once more on the next change, never on its own", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { state, shown, subject, notices } = setup();
    state.failing = new Set(["1"]);
    notices.update([need("1")]);
    await settle(noticeGapMs * 3);
    expect(shown).toEqual([]);
    expect(subject).toHaveBeenCalledTimes(1);
    notices.update([need("1")]);
    await settle(noticeGapMs * 3);
    expect(subject).toHaveBeenCalledTimes(2);
    state.failing = new Set();
    notices.update([need("1"), need("2")]);
    await settle(noticeGapMs * 3);
    notices.update([need("1"), need("2")]);
    await settle(noticeGapMs * 3);
    expect(shown.map(({ text }) => text.title)).toEqual(["2 workspaces need you"]);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("announces later what a stale lookup held, once", async () => {
    const { state, shown, notices } = setup();
    state.slow.set("1", noticeGapMs * 2);
    notices.update([need("1")]);
    await settle(1);
    notices.update([need("1"), need("2")]);
    await settle(noticeGapMs * 3);
    state.slow.clear();
    notices.update([need("1"), need("2")]);
    await settle(noticeGapMs);
    notices.update([need("1"), need("2")]);
    await settle(noticeGapMs * 2);
    expect(shown.map(({ text }) => text.title)).toEqual(["w2 needs you", "w1 needs you"]);
  });
});

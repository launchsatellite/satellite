import { describe, expect, it, vi } from "vitest";
import { createPageOwners } from "./page-owners.ts";

const terminalId = "6f1c2a7e-3b4d-4c5e-9f60-718293a4b5c6";

function pages() {
  const send = vi.fn<(page: object, event: string, payload: unknown) => void>();
  return { send, owners: createPageOwners<object>(send) };
}

describe("createPageOwners", () => {
  it("a listener added after gone fires at once", () => {
    const { owners } = pages();
    const page = {};
    const owner = owners.ownerFor(page);
    owners.end(page);
    const cleanup = vi.fn();
    owner.onGone(cleanup);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("fires listeners added before gone exactly once", () => {
    const { owners } = pages();
    const page = {};
    const cleanup = vi.fn();
    owners.ownerFor(page).onGone(cleanup);
    owners.end(page);
    owners.end(page);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("emit after gone is dropped", () => {
    const { owners, send } = pages();
    const page = {};
    const owner = owners.ownerFor(page);
    owner.emit("terminal.exit", { id: terminalId, exitCode: 0, ending: "ended" });
    owners.end(page);
    owner.emit("terminal.data", { id: terminalId, data: "late output" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(page, "terminal.exit", {
      id: terminalId,
      exitCode: 0,
      ending: "ended",
    });
  });

  it("a reload yields a new owner", () => {
    const { owners } = pages();
    const page = {};
    const first = owners.ownerFor(page);
    expect(owners.ownerFor(page)).toBe(first);
    owners.end(page);
    const second = owners.ownerFor(page);
    expect(second).not.toBe(first);
    expect(second.id).not.toBe(first.id);
  });
});

import { describe, expect, it } from "vitest";
import type { FileRead, FilesList, FolderListing } from "../../shared/bridge-contract.ts";
import { afterList, afterRead, type FileShown } from "./use-files.ts";

const failure = { ok: false, error: { code: "failed", message: "Something went wrong." } } as const;
const text = (body: string): Extract<FileRead, { kind: "text" }> => ({
  kind: "text",
  text: body,
  stamp: `${body}:1:1`,
});
const answer = (read: FileRead) => ({ ok: true, value: read }) as const;
const shown = (read: Exclude<FileRead, { kind: "same" }>): FileShown => ({ path: "a.ts", read });
const listing = (...names: string[]): FolderListing => ({
  state: "listed",
  entries: names.map((name) => ({ name, kind: "file", ignored: false })),
  more: 0,
});
const folders = (...answers: [string, FolderListing][]): { ok: true; value: FilesList } => ({
  ok: true,
  value: { folders: answers.map(([path, state]) => ({ path, listing: state })) },
});

describe("afterRead", () => {
  it("keeps the shown file and says why when a read fails or is refused", () => {
    const good = shown(text("kept"));
    expect(afterRead(good, "k1", "a.ts", failure)).toEqual({
      value: good,
      problem: "Something went wrong.",
    });
    const gone = shown({ kind: "gone" });
    expect(afterRead(gone, "k2", "a.ts", failure).value).toBe(gone);
  });

  it("keeps the last good text when a read hangs or the file changes under it", () => {
    const good = shown(text("kept"));
    for (const kind of ["hung", "changing"] as const) {
      const outcome = afterRead(good, "k3", "a.ts", answer({ kind }));
      expect(outcome.value).toBe(good);
      expect(outcome.problem).not.toBeNull();
    }
  });

  it("shows a settled sentence kind in place of the text", () => {
    const outcome = afterRead(shown(text("old")), "k4", "a.ts", answer({ kind: "gone" }));
    expect(outcome.value).toEqual({ path: "a.ts", read: { kind: "gone" } });
    expect(outcome.problem).toBeNull();
  });

  it("keeps the same object for an unchanged answer so nothing redraws", () => {
    const current = shown(text("same"));
    expect(afterRead(current, "k5", "a.ts", answer(text("same"))).value).toBe(current);
    expect(afterRead(current, "k5", "a.ts", answer({ kind: "same" })).value).toBe(current);
  });
});

describe("afterList", () => {
  it("keeps a listed folder when a later answer hangs or fails", () => {
    const before = new Map([["", listing("a.ts")]]);
    for (const state of ["hung", "failed"] as const) {
      const outcome = afterList(before, [""], folders(["", { state }]));
      expect(outcome.value).toBe(before);
      expect(outcome.problem).not.toBeNull();
    }
  });

  it("keeps the same map for an unchanged answer", () => {
    const before = new Map([["", listing("a.ts")]]);
    const outcome = afterList(before, [""], folders(["", listing("a.ts")]));
    expect(outcome.value).toBe(before);
    expect(outcome.problem).toBeNull();
  });

  it("keeps the old listings when the whole request fails and marks only unknown folders", () => {
    const before = new Map([["", listing("a.ts")]]);
    const outcome = afterList(before, ["", "src"], failure);
    expect(outcome.value.get("")).toEqual(listing("a.ts"));
    expect(outcome.value.get("src")).toEqual({ state: "failed" });
  });
});

import { describe, expect, it } from "vitest";
import type { FileRead } from "../../shared/bridge-contract.ts";
import { fileSentence, moreEntries, rowLabel } from "./file-words.ts";

const reads: FileRead[] = [
  { kind: "text", text: "", stamp: "1" },
  { kind: "link", text: "x", stamp: "1" },
  { kind: "image", type: "image/png", data: "", stamp: "1" },
  { kind: "same" },
  { kind: "binary", stamp: "1" },
  { kind: "large", stamp: "1" },
  { kind: "not-utf8", stamp: "1" },
  { kind: "gone" },
  { kind: "changing" },
  { kind: "hung" },
  { kind: "unreadable" },
];

describe("file words", () => {
  it("answers a sentence for every kind that is not drawn, none with a colon", () => {
    for (const read of reads) {
      const sentence = fileSentence(read);
      if (["text", "link", "image", "same"].includes(read.kind)) {
        expect(sentence).toBeUndefined();
        continue;
      }
      expect(sentence).toBeTruthy();
      expect(sentence).not.toContain(":");
    }
  });

  it("counts unlisted entries and names a row's state", () => {
    expect(moreEntries(1)).toBe("1 more entry is not listed.");
    expect(moreEntries(1200)).toBe("1,200 more entries are not listed.");
    expect(rowLabel("a/b.ts", "file", "A", false, false)).toBe("a/b.ts, added, not tracked yet");
    expect(rowLabel("a/b.ts", "file", undefined, true, true)).toBe("a/b.ts, ignored by git");
    expect(rowLabel("a", "repository", "M", true, false)).toBe(
      "a, modified, repository of its own",
    );
  });
});

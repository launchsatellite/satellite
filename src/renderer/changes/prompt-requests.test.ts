import { describe, expect, it } from "vitest";
import { promptText } from "../../shared/prompt-text.ts";
import { cleanBase, conflictRequest, lineReference } from "./prompt-requests.ts";

describe("conflictRequest", () => {
  it("asks to update from a base named by Satellite's words only", () => {
    expect(conflictRequest("origin/main")).toBe(
      "Update this branch from origin/main and resolve the conflicts.",
    );
    for (const base of [
      "a\u{202e}b",
      "two words",
      'quo"te',
      "back`tick",
      "it's",
      "",
      null,
      "main\u{3164}",
      "a\u{fe00}b",
    ]) {
      expect(cleanBase(base)).toBe("the base branch");
    }
  });
});

const base = "origin/main";

function reference(path: string, side: "original" | "modified", view: "branch" | "uncommitted") {
  return lineReference({ path, side, view, base, start: 2, end: 3 });
}

describe("lineReference", () => {
  it("points at lines on each side of a diff in Satellite's words", () => {
    const wording = (side: "original" | "modified", view: "branch" | "uncommitted") => {
      const found = reference("src/app.ts", side, view);
      return found.ok ? found.text : found.sentence;
    };
    expect(wording("modified", "branch")).toBe("Lines 2 to 3 of src/app.ts in this workspace. ");
    expect(wording("original", "uncommitted")).toBe(
      "Lines 2 to 3 of src/app.ts as of the last commit. ",
    );
    expect(wording("original", "branch")).toBe(
      "Lines 2 to 3 of src/app.ts at the merge base with origin/main. ",
    );
    expect(
      lineReference({ path: "a.ts", side: "modified", view: "branch", base, start: 4, end: 4 }),
    ).toEqual({ ok: true, text: "Line 4 of a.ts in this workspace. " });
    expect(
      lineReference({
        path: "a.ts",
        side: "original",
        view: "branch",
        base: null,
        start: 1,
        end: 1,
      }),
    ).toEqual({ ok: true, text: "Line 1 of a.ts at the merge base with the base branch. " });
  });

  it("quotes a path with spaces, quotes or unicode so it reads whole", () => {
    const text = (path: string) => {
      const found = reference(path, "modified", "branch");
      return found.ok ? found.text : found.sentence;
    };
    expect(text("caf\u{e9} notes.md")).toBe(
      'Lines 2 to 3 of "caf\u{e9} notes.md" in this workspace. ',
    );
    expect(text("it's new.txt")).toBe('Lines 2 to 3 of "it\'s new.txt" in this workspace. ');
    expect(text('say "hi".txt')).toBe('Lines 2 to 3 of "say \\"hi\\".txt" in this workspace. ');
    expect(text("src/app.ts")).toBe("Lines 2 to 3 of src/app.ts in this workspace. ");
    expect(text("-dash.txt")).toBe("Lines 2 to 3 of -dash.txt in this workspace. ");
  });

  it("refuses a path with hidden characters or a reference too long to send", () => {
    for (const path of [
      "a\u{202e}b.md",
      "a\nb.md",
      "a\rb",
      "a\u001b[201~b",
      "a\u{200b}b",
      "a\u{e0041}b",
      "a\u0085b",
      "report\u{3164}.md",
      "a\u{fe0f}b",
      "a\u{2800}b",
      "[U+202E]x",
    ]) {
      const found = reference(path, "modified", "branch");
      expect(found.ok).toBe(false);
      if (!found.ok) expect(found.sentence).toMatch(/hidden characters/);
    }
    const long = reference("x".repeat(790), "modified", "branch");
    expect(long).toEqual({
      ok: false,
      sentence: "This file's path is too long to send. Ask in your own words.",
    });
    const fits = reference("x".repeat(740), "modified", "branch");
    expect(fits.ok).toBe(true);
  });

  it("never sends text the prompt's cleaner would change, whatever the name holds", () => {
    const pieces = [
      "a",
      " ",
      '"',
      "\\",
      "\u001b[201~",
      "\r",
      "\n",
      "\u{202e}",
      "\u{200b}",
      "\u{e0041}",
      "\u{a0}",
      "\u200d",
      "\u{1f600}",
      "\ud800",
      "x".repeat(300),
    ];
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let run = 0; run < 3000; run += 1) {
      const path = Array.from(
        { length: 1 + (next() % 6) },
        () => pieces[next() % pieces.length] ?? "",
      ).join("");
      const found = reference(path, "original", "branch");
      if (found.ok) {
        expect(promptText(found.text)).toBe(found.text);
        expect(found.text.length).toBeLessThanOrEqual(800);
        expect(/\p{Cc}/u.test(found.text)).toBe(false);
      }
    }
  });

  it("refuses lines that do not exist", () => {
    for (const [start, end] of [
      [0, 1],
      [3, 2],
      [1.5, 2],
      [-1, 1],
      [Number.NaN, 1],
    ] as const) {
      const found = lineReference({
        path: "a",
        side: "modified",
        view: "branch",
        base,
        start,
        end,
      });
      expect(found.ok).toBe(false);
    }
  });
});

describe("file mentions", () => {
  const mentionLike = /(?:^|[\s"'`])@/u;

  it("refuses a path that starts with @ or holds @ after a space or a quote, and keeps a scoped folder", () => {
    for (const path of ["@~/.ssh/id_rsa", "@/etc/passwd", "a b @~/x", 'a"@x', "a'@x", "a`@x"]) {
      const found = lineReference({
        path,
        side: "modified",
        view: "branch",
        base,
        start: 1,
        end: 2,
      });
      expect(found.ok, path).toBe(false);
      if (!found.ok) expect(found.sentence).toMatch(/file mention/);
    }
    const scoped = lineReference({
      path: "node_modules/@scope/pkg/index.js",
      side: "modified",
      view: "branch",
      base,
      start: 1,
      end: 2,
    });
    expect(scoped.ok).toBe(true);
    for (const name of ["@/etc/passwd", "@~", "@x"]) {
      expect(cleanBase(name)).toBe("the base branch");
    }
    expect(cleanBase("origin/@scope")).toBe("origin/@scope");
  });

  it("never types a mention for any name built from the characters that can make one", () => {
    const alphabet = ["@", "/", " ", '"', "'", "`", "~", "a", ".", "\\", "\t"];
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let round = 0; round < 5000; round += 1) {
      const length = 1 + (next() % 8);
      const path = Array.from({ length }, () => alphabet[next() % alphabet.length]).join("");
      const found = lineReference({
        path,
        side: "modified",
        view: "branch",
        base,
        start: 1,
        end: 2,
      });
      if (found.ok) expect(mentionLike.test(found.text), JSON.stringify(path)).toBe(false);
      expect(mentionLike.test(conflictRequest(path)), JSON.stringify(path)).toBe(false);
    }
  });
});

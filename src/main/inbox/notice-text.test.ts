import { describe, expect, it } from "vitest";
import { noticeName, noticeNameLimit } from "../../shared/notice-name.ts";
import { noticeText } from "./notice-text.ts";

const bytes = (text: string) => new TextEncoder().encode(text).length;
const hostile = '<b>x</b> & "y"\n\u202ez\u0007';
const unsafe = ["<", ">", "&", '"', "\n", "\u202e", "\u0007"];

describe("noticeText", () => {
  it("names the workspace and its project", () => {
    expect(noticeText([{ project: "repo", parent: null, workspace: "alpha" }], 1)).toEqual({
      title: "alpha needs you",
      body: "Claude Code is waiting for you in repo.",
    });
  });

  it("names the project for its main workspace", () => {
    expect(noticeText([{ project: "repo", parent: null, workspace: null }], 1)).toEqual({
      title: "repo needs you",
      body: "Claude Code is waiting for you in the main workspace.",
    });
  });

  it("counts every workspace that waits when it gathers several", () => {
    expect(
      noticeText(
        [
          { project: "repo", parent: null, workspace: "alpha" },
          { project: "repo", parent: null, workspace: null },
          { project: "other", parent: null, workspace: "beta" },
        ],
        5,
      ),
    ).toEqual({
      title: "5 workspaces need you",
      body: "Open Satellite to answer them from the inbox.",
    });
  });

  it("keeps markup, control and direction characters out of a name", () => {
    const named = noticeText([{ project: hostile, parent: null, workspace: hostile }], 1);
    for (const text of [named.title, named.body]) {
      for (const character of unsafe) expect(text).not.toContain(character);
    }
    expect(
      noticeText([{ project: '<>&"\n\u202e\u0007', parent: null, workspace: null }], 1).title,
    ).toBe("a project needs you");
    expect(
      noticeText([{ project: "repo", parent: null, workspace: "\u2066\u0000" }], 1).title,
    ).toBe("a workspace needs you");
  });

  it("keeps invisible and line breaking characters out of a name", () => {
    const hidden = "a\u200bb\u2060c\ufeffd\u3164e\u034ff\ufe0fg\u{e0041}h\u2028i\u00a0j\tk\r\nl";
    expect(noticeName(hidden, "a project")).toBe("a b c d e f g h i j k l");
    expect(noticeName("\u3164\u115f\u200d", "a project")).toBe("a project");
  });

  it("cuts a long name and stays inside 256 bytes", () => {
    const long = "\u{10348}".repeat(200);
    expect(Array.from(noticeName(long, "a project"))).toHaveLength(noticeNameLimit);
    expect(noticeName(`${"a".repeat(31)}  b`, "a project")).toBe("a".repeat(31));
    for (const subject of [
      { project: long, parent: long, workspace: long },
      { project: long, parent: long, workspace: null },
    ]) {
      const { title, body } = noticeText([subject], 1);
      expect(bytes(title)).toBeLessThanOrEqual(256);
      expect(bytes(body)).toBeLessThanOrEqual(256);
    }
  });

  it("falls back when a name holds no letter or digit, and drops marks that lead it", () => {
    for (const raw of [".", "_", "+()", "- . -", "\u20dd", "\u0301\u0301"]) {
      expect(noticeName(raw, "a project")).toBe("a project");
    }
    expect(noticeName("\u0301app", "a project")).toBe("app");
    expect(noticeText([{ project: "...", parent: null, workspace: "()" }], 1)).toEqual({
      title: "a workspace needs you",
      body: "Claude Code is waiting for you in a project.",
    });
  });

  it("never splits a letter cluster when it cuts, however long the name", () => {
    const syllable = "\u1100\u1161\u11a8";
    expect(noticeName(syllable.repeat(12), "a project")).toBe(syllable.repeat(10));
    const cluster = "\u0915\u093f";
    expect(noticeName(cluster.repeat(20), "a project")).toBe(cluster.repeat(16));
    expect(noticeName("a".repeat(1_000_000), "a project")).toBe("a".repeat(noticeNameLimit));
  });

  it("names the parent folder when two projects share a name", () => {
    expect(noticeText([{ project: "app", parent: "one", workspace: "alpha" }], 1)).toEqual({
      title: "alpha needs you",
      body: "Claude Code is waiting for you in app in one.",
    });
    expect(noticeText([{ project: "app", parent: "two", workspace: null }], 1).title).toBe(
      "app in two needs you",
    );
    expect(noticeText([{ project: "app", parent: "<>", workspace: null }], 1).title).toBe(
      "app in a folder needs you",
    );
    expect(noticeText([{ project: "app", parent: "p".repeat(40), workspace: null }], 1).title).toBe(
      `app in ${"p".repeat(16)} needs you`,
    );
  });
});

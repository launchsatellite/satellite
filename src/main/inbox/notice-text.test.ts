import { describe, expect, it } from "vitest";
import { noticeName, noticeNameLimit, noticeText } from "./notice-text.ts";

const bytes = (text: string) => new TextEncoder().encode(text).length;
const hostile = '<b>x</b> & "y"\n\u202ez\u0007';
const unsafe = ["<", ">", "&", '"', "\n", "\u202e", "\u0007"];

describe("noticeText", () => {
  it("names the workspace and its project", () => {
    expect(noticeText([{ project: "repo", workspace: "alpha" }])).toEqual({
      title: "alpha needs you",
      body: "Claude Code is waiting for you in repo.",
    });
  });

  it("names the project for its main workspace", () => {
    expect(noticeText([{ project: "repo", workspace: null }])).toEqual({
      title: "repo needs you",
      body: "Claude Code is waiting for you in the main workspace.",
    });
  });

  it("counts several workspaces", () => {
    expect(
      noticeText([
        { project: "repo", workspace: "alpha" },
        { project: "repo", workspace: null },
        { project: "other", workspace: "beta" },
      ]),
    ).toEqual({
      title: "3 workspaces need you",
      body: "Open Satellite to answer them from the inbox.",
    });
  });

  it("keeps markup, control and direction characters out of a name", () => {
    const named = noticeText([{ project: hostile, workspace: hostile }]);
    for (const text of [named.title, named.body]) {
      for (const character of unsafe) expect(text).not.toContain(character);
    }
    expect(noticeText([{ project: '<>&"\n\u202e\u0007', workspace: null }]).title).toBe(
      "a project needs you",
    );
    expect(noticeText([{ project: "repo", workspace: "\u2066\u0000" }]).title).toBe(
      "a workspace needs you",
    );
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
      { project: long, workspace: long },
      { project: long, workspace: null },
    ]) {
      const { title, body } = noticeText([subject]);
      expect(bytes(title)).toBeLessThanOrEqual(256);
      expect(bytes(body)).toBeLessThanOrEqual(256);
    }
  });
});

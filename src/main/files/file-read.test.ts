import { execFileSync } from "node:child_process";
import { mkdir, symlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { filesLimits } from "../../shared/bridge-contract.ts";
import { readFileForViewing } from "./file-read.ts";
import { gif, jpeg, png, webpExtended, webpLossless, webpLossy } from "./image-fixture.ts";
import {
  isolateGit,
  makeRepository,
  mockedEnvironment,
  put,
  scratch,
} from "./repository-fixture.ts";

vi.mock("../platform/user-environment.ts", () => ({
  userEnvironment: () => mockedEnvironment(),
}));

beforeEach(isolateGit);
afterEach(() => {
  vi.unstubAllEnvs();
});

async function seen(root: string, path: string, known: string | null = null): Promise<unknown> {
  const read = await readFileForViewing(root, path, known);
  if (!("stamp" in read)) return read;
  expect(read.stamp).toMatch(/^\d+:\d+:\d+$/);
  return Object.fromEntries(Object.entries(read).filter(([key]) => key !== "stamp"));
}

describe("readFileForViewing", () => {
  it("refuses a file reached through a linked folder, .git, an absolute path and a path that climbs out", async () => {
    const root = await makeRepository();
    const outside = join(await scratch(), "outside");
    await put(outside, { "secret.txt": "secret\n" });
    await put(root, { "ok.txt": "ok\n" });
    await symlink(outside, join(root, "linked"), "junction");
    for (const path of [
      "linked/secret.txt",
      ".git/config",
      ".GIT/HEAD",
      "/etc/passwd",
      "C:/Windows/win.ini",
      "../outside/secret.txt",
      "ok.txt/../ok.txt",
      "",
    ]) {
      expect(await seen(root, path, null)).toEqual({ kind: "unreadable" });
    }
    expect(await seen(root, "ok.txt", null)).toEqual({
      kind: "text",
      text: "ok\n",
    });
  });

  it.skipIf(process.platform === "win32")(
    "shows a link as its target and never follows it",
    async () => {
      const root = await makeRepository();
      await symlink("/etc/hosts", join(root, "to-hosts"));
      await symlink("missing-target", join(root, "dangling"));
      expect(await seen(root, "to-hosts", null)).toEqual({
        kind: "link",
        text: "/etc/hosts",
      });
      expect(await seen(root, "dangling", null)).toEqual({
        kind: "link",
        text: "missing-target",
      });
    },
  );

  it("reads an ignored file and a file in an ignored folder like any other", async () => {
    const root = await makeRepository();
    await put(root, {
      ".gitignore": "*.log\nbuild/\n",
      "debug.log": "log\n",
      "build/out.js": "out\n",
    });
    await writeFile(join(root, ".git", "index"), "not an index");
    expect(await seen(root, "debug.log", null)).toEqual({
      kind: "text",
      text: "log\n",
    });
    expect(await seen(root, "build/out.js", null)).toMatchObject({ kind: "text" });
    expect(await seen(root, "nothing.txt", null)).toEqual({ kind: "gone" });
    expect(await seen(root, "nothing/deeper.txt", null)).toEqual({ kind: "gone" });
  });

  it("answers same only for the stamp the file has now", async () => {
    const root = await makeRepository();
    await put(root, { "a.txt": "one\n" });
    const first = await readFileForViewing(root, "a.txt", null);
    if (first.kind !== "text") throw new Error("expected text");
    expect(await seen(root, "a.txt", first.stamp)).toEqual({ kind: "same" });
    expect(await seen(root, "a.txt", "1:2:3")).toMatchObject({ kind: "text" });
    await writeFile(join(root, "a.txt"), "two\n");
    await utimes(join(root, "a.txt"), new Date(2020, 1, 1), new Date(2020, 1, 1));
    const next = await seen(root, "a.txt", first.stamp);
    expect(next).toMatchObject({ kind: "text", text: "two\n" });
  });

  it("answers image for each format and large for more than 50 million pixels or 5 MiB", async () => {
    const root = await makeRepository();
    const images = {
      "a.png": [png(640, 480), "image/png"],
      "a.gif": [gif(3, 3), "image/gif"],
      "a.jpg": [jpeg(10, 10), "image/jpeg"],
      "x.webp": [webpExtended(9, 9), "image/webp"],
      "y.webp": [webpLossy(9, 9), "image/webp"],
      "z.webp": [webpLossless(9, 9), "image/webp"],
      "renamed.txt": [png(5, 5), "image/png"],
    } as const;
    for (const [name, [bytes]] of Object.entries(images)) {
      await writeFile(join(root, name), bytes);
    }
    for (const [name, [bytes, type]] of Object.entries(images)) {
      expect(await seen(root, name, null)).toEqual({
        kind: "image",
        type,
        data: Buffer.from(bytes).toString("base64"),
      });
    }
    await writeFile(join(root, "huge.png"), png(10_000, 10_000));
    await writeFile(join(root, "edge.png"), png(10_000, 5000));
    await writeFile(join(root, "over.png"), png(5001, 10_000));
    const heavy = Buffer.alloc(filesLimits.imageBytes + 1);
    heavy.set(png(10, 10));
    await writeFile(join(root, "heavy.png"), heavy);
    heavy.fill(65);
    await writeFile(join(root, "heavy.txt"), heavy);
    expect(await seen(root, "huge.png", null)).toEqual({ kind: "large" });
    expect(await seen(root, "edge.png", null)).toMatchObject({ kind: "image" });
    expect(await seen(root, "over.png", null)).toEqual({ kind: "large" });
    expect(await seen(root, "heavy.png", null)).toEqual({ kind: "large" });
    expect(await seen(root, "heavy.txt", null)).toEqual({ kind: "large" });
  });

  it("answers binary for an image that is malformed or only claims to be one and text for SVG", async () => {
    const root = await makeRepository();
    await writeFile(join(root, "bad.png"), png(5, 5).subarray(0, 20));
    await writeFile(join(root, "zero.png"), png(0, 5));
    await writeFile(join(root, "vector.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>\n");
    await writeFile(join(root, "bad.gif"), Buffer.from("GIF89a"));
    expect(await seen(root, "bad.png", null)).toEqual({ kind: "binary" });
    expect(await seen(root, "zero.png", null)).toEqual({ kind: "binary" });
    expect(await seen(root, "bad.gif", null)).toEqual({ kind: "binary" });
    expect(await seen(root, "vector.svg", null)).toMatchObject({ kind: "text" });
  });

  it("answers binary for a NUL, not-utf8 for bytes that are not text, large past the line limit", async () => {
    const root = await makeRepository();
    await writeFile(join(root, "zero.bin"), Buffer.from([65, 0, 66]));
    await writeFile(join(root, "latin.txt"), Buffer.from([0xc3, 0x28]));
    await writeFile(join(root, "tall.txt"), "\n".repeat(20_001));
    await writeFile(join(root, "limit.txt"), "\n".repeat(20_000));
    await writeFile(join(root, "wide.txt"), Buffer.alloc(1_048_577, 65));
    await writeFile(join(root, "crlf.txt"), "a\r\nb\r\n");
    await writeFile(join(root, "empty.txt"), "");
    expect(await seen(root, "zero.bin", null)).toEqual({ kind: "binary" });
    expect(await seen(root, "latin.txt", null)).toEqual({ kind: "not-utf8" });
    expect(await seen(root, "tall.txt", null)).toEqual({ kind: "large" });
    expect(await seen(root, "limit.txt", null)).toMatchObject({ kind: "text" });
    expect(await seen(root, "wide.txt", null)).toEqual({ kind: "large" });
    expect(await seen(root, "crlf.txt", null)).toMatchObject({
      kind: "text",
      text: "a\r\nb\r\n",
    });
    expect(await seen(root, "empty.txt", null)).toMatchObject({
      kind: "text",
      text: "",
    });
  });

  it.skipIf(process.platform === "win32")("never opens a pipe", async () => {
    const root = await makeRepository();
    execFileSync("mkfifo", [join(root, "pipe")]);
    await mkdir(join(root, "dir"));
    expect(await seen(root, "pipe", null)).toEqual({ kind: "binary" });
    expect(await seen(root, "dir", null)).toEqual({ kind: "gone" });
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownBody, plainSentence } from "./markdown-elements.tsx";
import { parseMarkdown } from "./markdown-tree.ts";

const render = (text: string) =>
  renderToStaticMarkup(
    createElement(MarkdownBody, { text, tree: parseMarkdown(text), onLink: () => undefined }),
  );
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("MarkdownBody", () => {
  it("draws headings, lists, a table, a task list and code", () => {
    const html = render(
      [
        "# Title",
        "## Sub",
        "- one",
        "- two",
        "",
        "| a | b |",
        "| - | - |",
        "| 1 | 2 |",
        "",
        "- [x] done",
        "- [ ] todo",
        "",
        "```ts",
        "const x = 1;",
        "```",
        "and `inline`",
      ].join("\n"),
    );
    for (const text of ["Title", "Sub", "one", "two", "done", "todo", "const x = 1;", "inline"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain("<table");
    expect(html).toContain("<pre");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<h1");
    expect(html).not.toContain("<h2");
    expect(html).toContain('data-testid="markdown"');
  });

  it("draws no raw HTML", () => {
    const html = render(
      [
        "<script>alert(1)</script>",
        "",
        "<img src=x onerror=alert(1)>",
        "",
        '<iframe src="https://evil.example.invalid"></iframe>',
        "",
        "<style>body{display:none}</style>",
        "",
        '<form action="https://evil.example.invalid"><input name=a></form>',
        "",
        '<a href="https://evil.example.invalid" onclick="alert(1)">click</a>',
        "",
        "<svg onload=alert(1)></svg>",
        "",
        "<!-- hidden comment -->",
        "",
        "text with <b onmouseover=alert(1)>inline</b> html",
      ].join("\n"),
    );
    for (const needle of [
      "<script",
      "<img",
      "<iframe",
      "<style",
      "<form",
      "<svg",
      "<b ",
      "<a ",
      "onerror",
      "onclick",
      "onload",
      "onmouseover",
      "<!--",
    ]) {
      expect(html, needle).not.toContain(needle);
    }
  });

  it("never draws an image element", () => {
    const html = render(
      [
        "![x](https://tracker.example.invalid/p.png)",
        "",
        "![ref][pixel]",
        "",
        "[![inside](https://tracker.example.invalid/inside.png)](https://example.invalid/target)",
        "",
        "[pixel]: https://tracker.example.invalid/ref.png",
      ].join("\n"),
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("src=");
    expect(count(html, 'data-testid="markdown-image"')).toBe(3);
    expect(html).toContain('data-address="https://tracker.example.invalid/p.png"');
    expect(html).toContain('data-address="https://tracker.example.invalid/ref.png"');
    expect(html).toContain('data-address="https://tracker.example.invalid/inside.png"');
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*<button/);
  });

  it("an image whose source is not https shows only its alt text", () => {
    const html = render(
      "![alt text](data:image/png;base64,AAAA) ![b](http://x.example.invalid/i.png)",
    );
    expect(html).not.toContain("markdown-image");
    expect(html).not.toContain("data:");
    expect(html).toContain("alt text");
  });

  it("a link is a button with no href", () => {
    const html = render("[docs](https://example.invalid/docs) and https://example.invalid/auto");
    expect(html).not.toContain("href=");
    expect(count(html, 'data-testid="markdown-link"')).toBe(2);
    expect(html).toContain('<button type="button"');
    expect(html).toContain('data-address="https://example.invalid/docs"');
  });

  it("a link that is not https is plain text", () => {
    for (const target of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,x",
      "vbscript:msgbox(1)",
      "file:///etc/hosts",
      "http://example.invalid",
      "vscode://x",
      "../x",
      "//example.invalid/x",
    ]) {
      const html = render(`[pressed](${target})`);
      expect(html, target).not.toContain("markdown-link");
      expect(html, target).not.toContain("<button");
      expect(html, target).not.toContain("href=");
      expect(html, target).toContain("pressed");
    }
  });

  it("shows the real address of a link whose text is another address", () => {
    const html = render("[https://github.com/real/thing](https://evil.example.invalid/phish)");
    expect(html).toContain('data-address="https://evil.example.invalid/phish"');
    expect(html).not.toContain('data-address="https://github.com/real/thing"');
  });

  it("keeps the line breaks of code and paragraphs while revealing hidden characters", () => {
    const html = render("```\nline one\nline two\n```\n\nsoft\nbreak");
    expect(html).toContain("line one\nline two");
    expect(html).not.toContain("U+000A");
  });

  it("reveals a direction override in the source", () => {
    const html = render("evil‮txt.exe");
    expect(html).not.toContain("‮");
    expect(html).toContain("U+202E");
  });

  it("stays bounded on 20,000 characters of nested quotes", () => {
    const html = render(`${"> ".repeat(10_000)}deep`);
    expect(html).toContain("deep");
  });

  it("draws very deep nesting as text instead of failing", () => {
    for (const depth of [50, 500, 3000, 10_000]) {
      const html = render(`${"> ".repeat(depth)}deep`);
      expect(html, String(depth)).toContain("deep");
      expect(html, String(depth)).toContain('data-testid="markdown"');
    }
    const indented = Array.from({ length: 150 }, (_, at) => `${" ".repeat(at * 2)}- item`).join(
      "\n",
    );
    expect(render(indented)).not.toContain("<ul");
  });

  it("keeps ordinary nesting and indented code as Markdown", () => {
    expect(render("- a\n  - b\n    - c")).toContain("<ul");
    expect(render("> a\n> > b")).toContain("<blockquote");
    expect(render(`${" ".repeat(80)}code`)).toContain("code");
  });

  it("reveals every hidden character, however it was written", () => {
    const html = render(
      "a&#8238;b &#x200B; &#xFEFF; &lrm; `c\u202Ed` [e&#8238;f](https://example.invalid/x) ![g&#x200B;h](https://example.invalid/i.png)\n\n```\nj&#x202E;k \u202E\n```",
    );
    for (const code of ["202E", "200B", "FEFF", "200E"]) expect(html).toContain(`[U+${code}]`);
    expect(html).toContain("a[U+202E]b");
    expect(html).toContain("c[U+202E]d");
    expect(html).toContain("e[U+202E]f");
    expect(html).toContain("Image g[U+200B]h");
    expect(html).toContain("j&amp;#x202E;k [U+202E]");
    expect(html).not.toMatch(/[\u200B\u200E\u202E\uFEFF]/u);
  });

  it("draws a long run of hidden characters as a paragraph, quickly", () => {
    const began = performance.now();
    const html = render("\u202E".repeat(20_000));
    expect(html).toContain("U+202E");
    expect(performance.now() - began).toBeLessThan(1500);
  });

  it("draws ordinary long documents as Markdown", () => {
    const tasks = Array.from({ length: 100 }, (_, at) => `- [ ] **task ${String(at)}** \`code\``);
    expect(render(tasks.join("\n"))).toContain("<strong>");
    const changelog = Array.from(
      { length: 150 },
      (_, at) =>
        `* **fix(scope_${String(at)}):** a change ([#${String(at)}](https://example.invalid/${String(at)}))`,
    );
    const log = render(changelog.join("\n"));
    expect(log).toContain("<strong>");
    expect(log).not.toContain(plainSentence);
    const rows = Array.from(
      { length: 300 },
      (_, at) => `| **${String(at)}** | \`x\` | [l](https://example.invalid/${String(at)}) |`,
    );
    const table = render(["| a | b | c |", "| - | - | - |", ...rows].join("\n"));
    expect(table).toContain("<table");
    expect(table).not.toContain(plainSentence);
  });

  it("draws plain text with its sentence when the tree is too deep", () => {
    const html = render(`${"> ".repeat(100)}deep`);
    expect(html).toContain(plainSentence);
    expect(html).not.toContain("<blockquote");
  });

  it("survives malformed, very long and deeply nested input", () => {
    const inputs = [
      "[unclosed(https://example.invalid",
      "![broken](",
      "**bold *mixed** italic*",
      "| a | b\n| - |\n| 1 |",
      `${"* ".repeat(200)}x`,
      "[a](https://example.invalid) ".repeat(2000),
      "x".repeat(200_000),
      "<<<<>>>>".repeat(5000),
      "&#0; &#x202E; &amp;lt;script&amp;gt;",
    ];
    for (const input of inputs) {
      const html = render(input);
      expect(html).not.toContain("<script");
      expect(html).not.toContain("<img");
    }
    expect(render("&lt;script&gt;alert(1)&lt;/script&gt;")).not.toContain("<script");
  });

  it("draws a link with credentials as text and normalises the address it opens", () => {
    const html = render(
      "[a](https://user:pass@example.invalid/x) [b](https://EXAMPLE.invalid:443/y) ![c](https://u@example.invalid/z.png)",
    );
    expect(html).not.toContain("user:pass");
    expect(html).not.toContain("u@example");
    expect(html).toContain('data-address="https://example.invalid/y"');
    expect(count(html, "<button")).toBe(1);
  });
});

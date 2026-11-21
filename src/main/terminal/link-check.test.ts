import { describe, expect, it } from "vitest";
import { checkedLink } from "./link-check.ts";

describe("checkedLink", () => {
  it("opens only web addresses", () => {
    expect(checkedLink("https://example.com/a?b#c")?.href).toBe("https://example.com/a?b#c");
    expect(checkedLink("http://127.0.0.1:3000/")?.href).toBe("http://127.0.0.1:3000/");
    for (const refused of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,x",
      "ssh://example.com",
      "https://user:pass@example.com",
      "https://user@example.com/",
      "https://",
      "https://exa mple.com",
      "https://example.com/\nx",
      "https://example.com/\u001b]8;;x",
      "https://example.com/\u{202e}gnp.exe",
      "mailto:a@example.com",
      `https://${"a".repeat(250)}.com/`,
    ]) {
      expect(checkedLink(refused), refused).toBeNull();
    }
  });

  it("opens only the address it would show, never a form the parser rewrites", () => {
    for (const rewritten of [
      "https://example.com",
      "https://EXAMPLE.com/",
      "https://exаmple.com/",
      "https://0x7f.1/",
      "https://example.com/a/../b",
    ]) {
      expect(checkedLink(rewritten), rewritten).toBeNull();
    }
    expect(checkedLink("https://xn--exmple-4nf.com/")?.hostname).toBe("xn--exmple-4nf.com");
  });
});

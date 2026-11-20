import { describe, expect, it } from "vitest";
import { createCommandRegistry, type Command } from "./command-registry.ts";

function command(id: Command["id"], shortcut?: Command["shortcut"]): Command {
  return { id, title: id, shortcut, available: true, run: () => undefined };
}

describe("createCommandRegistry", () => {
  it("refuses two commands with one id", () => {
    expect(() => createCommandRegistry([command("theme.dark"), command("theme.dark")])).toThrow();
  });

  it("refuses two commands with one shortcut", () => {
    expect(() =>
      createCommandRegistry([
        command("palette.commands", { key: "k" }),
        command("palette.switcher", { key: "k" }),
      ]),
    ).toThrow();
  });

  it("finds the command for a key press", () => {
    const registry = createCommandRegistry([
      command("palette.commands", { key: "k" }),
      command("palette.switcher", { key: "p" }),
      command("theme.dark"),
    ]);
    const found = registry.forKey(
      { key: "p", code: "KeyP", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
      "mac",
    );
    expect(found?.id).toBe("palette.switcher");
    expect(registry.get("theme.dark")?.id).toBe("theme.dark");
  });
});

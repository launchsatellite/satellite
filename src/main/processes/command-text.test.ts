import { describe, expect, it } from "vitest";
import { processesLimits } from "../../shared/bridge-contract.ts";
import { shownCommand } from "./command-text.ts";

const opaque = "t".repeat(40);

describe("shownCommand", () => {
  it("leaves an ordinary command as it is", () => {
    for (const command of ["npm run dev", "node /srv/app/node_modules/.bin/vite --port 5173"]) {
      expect(shownCommand(command)).toEqual({ text: command, cut: false });
    }
  });

  it("hides credentials inside an address", () => {
    expect(shownCommand("psql postgres://admin:hunter@db.local/app").text).toBe(
      "psql postgres://***@db.local/app",
    );
    expect(shownCommand("DATABASE_URL=postgres://admin:hunter@db.local/app node x").text).toBe(
      "DATABASE_URL=postgres://***@db.local/app node x",
    );
  });

  it("hides the value of a secret looking name, as an assignment and after a flag", () => {
    expect(shownCommand("API_KEY=abc node x").text).toBe("API_KEY=*** node x");
    expect(shownCommand("serve --token=abc").text).toBe("serve --token=***");
    expect(shownCommand("serve --password abc --port 3000").text).toBe(
      "serve --password *** --port 3000",
    );
    expect(shownCommand("serve --no-auth --port 3000").text).toBe("serve --no-auth --port 3000");
  });

  it("hides a bearer value and a long opaque word", () => {
    expect(shownCommand("curl -H Authorization: Bearer abc").text).toBe(
      "curl -H Authorization: Bearer ***",
    );
    expect(shownCommand(`run ${opaque}`).text).toBe("run ***");
    expect(shownCommand(`run ${"a".repeat(31)}`).text).toBe(`run ${"a".repeat(31)}`);
  });

  it("cuts to 200 characters after hiding, never through a pair, and says so", () => {
    const words = Array.from({ length: 60 }, (_, index) => `w${String(index)}`).join(" ");
    const result = shownCommand(words);
    expect(result.text).toHaveLength(processesLimits.commandChars);
    expect(result.cut).toBe(true);
    const pairs = shownCommand(`${"ab ".repeat(66)}c\u{1F680}\u{1F680}`);
    expect(pairs.text.endsWith("\uD83D")).toBe(false);
    expect(pairs.cut).toBe(true);
  });

  it("reads at most 1000 characters and drops the word the cut went through", () => {
    const raw = `${"ab ".repeat(333)}tailword`;
    const result = shownCommand(raw);
    expect(result.cut).toBe(true);
    expect(result.text).not.toContain("tailword");
    const long = "a".repeat(995);
    expect(shownCommand(`${long} bcde more`)).toEqual({ text: "*** bcde", cut: true });
    expect(shownCommand(`${long} bcdef more`)).toEqual({ text: "***", cut: true });
    expect(shownCommand("x".repeat(1100))).toEqual({ text: "", cut: true });
    const secretBeyond = shownCommand(`${"ab ".repeat(340)}--token ${opaque}`);
    expect(secretBeyond.text).not.toContain("t".repeat(10));
  });
});

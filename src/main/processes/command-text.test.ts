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

  it("shows the home folder as a tilde on a path boundary only", () => {
    const home = "/srv/me";
    const show = (command: string) => shownCommand(command, home).text;
    expect(show("node /srv/me/app/x.js --root=/srv/me")).toBe("node ~/app/x.js --root=~");
    expect(show("node /srv/me2/x.js /opt/srv/me/x.js /srv/mex")).toBe(
      "node /srv/me2/x.js /opt/srv/me/x.js /srv/mex",
    );
    expect(show("run '/srv/me/a' /srv/me/b:/srv/me/c")).toBe("run '~/a' ~/b:~/c");
    expect(show("open file:///srv/me/app/index.html")).toBe("open file://~/app/index.html");
    expect(show("-cp /srv/me/a.jar:/srv/me:/x (/srv/me) /srv/me, x=/srv/me;y")).toBe(
      "-cp ~/a.jar:~:/x (~) ~, x=~;y",
    );
    expect(shownCommand("node C:/srv/me/x.js", String.raw`C:\srv\me`).text).toBe("node ~/x.js");
    expect(shownCommand("node /srv/me/x.js", "/srv/me/").text).toBe("node ~/x.js");
    expect(shownCommand("node /srv/me/x.js").text).toBe("node /srv/me/x.js");
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

  it("hides the other common shapes of a secret", () => {
    const hide = (command: string) => shownCommand(command).text;
    expect(hide("run DB_PASS=abc PORT=3000")).toBe("run DB_PASS=*** PORT=3000");
    expect(hide("serve --pass abc --api-key def --secret=ghi")).toBe(
      "serve --pass *** --api-key *** --secret=***",
    );
    expect(hide('serve --password "a b c" --port 3000')).toBe(
      "serve --password *** *** *** --port 3000",
    );
    expect(hide("curl -H X-Api-Key: abc http://h/")).toBe("curl -H X-Api-Key: *** http://h/");
    expect(hide("curl -H Authorization:Bearer abc http://h/")).toBe(
      "curl -H Authorization:*** abc http://h/",
    );
    expect(hide("curl --header Authorization: Bearer abc")).toBe(
      "curl --header Authorization: Bearer ***",
    );
    expect(hide("curl http://h/?a=1&password=abc&b=2")).toBe("curl http://h/?a=1&password=***&b=2");
    expect(hide("ssh admin:hunter@host")).toBe("ssh admin:***@host");
    expect(hide("ssh git@github.com:org/repo.git")).toBe("ssh git@github.com:org/repo.git");
  });

  it("hides by whole option names, so ordinary flags keep their values", () => {
    const hide = (command: string) => shownCommand(command).text;
    expect(hide("run --keyboard-layout us --compass north --passWithNoTests x")).toBe(
      "run --keyboard-layout us --compass north --passWithNoTests x",
    );
    expect(hide("echo basic value && echo bearer other")).toBe(
      "echo basic value && echo bearer other",
    );
    expect(hide("run --client-secret a --accessToken b PGPASSWORD=c")).toBe(
      "run --client-secret *** --accessToken *** PGPASSWORD=***",
    );
    expect(hide("curl http://h/?keyboard=us&api_key=abc")).toBe(
      "curl http://h/?keyboard=us&api_key=***",
    );
  });

  it("hides the password of a user flag only where a colon makes it a credential", () => {
    const hide = (command: string) => shownCommand(command).text;
    expect(hide("curl -u admin:hunter http://h/")).toBe("curl -u admin:*** http://h/");
    expect(hide("curl --user=admin:hunter http://h/")).toBe("curl --user=admin:*** http://h/");
    expect(hide("mysql -u root --port 3306")).toBe("mysql -u root --port 3306");
  });

  it("stays bounded on hostile words", () => {
    for (const word of [
      "key=".repeat(300),
      "key".repeat(400),
      "a:".repeat(500),
      `"${"?&key=".repeat(150)}`,
    ]) {
      expect(shownCommand(`${word} tail`).text.length).toBeLessThanOrEqual(
        processesLimits.commandChars,
      );
    }
  });

  it("keeps a bare -p, -u and a port", () => {
    expect(shownCommand("mysql -u root -p 3306 --port 3306").text).toBe(
      "mysql -u root -p 3306 --port 3306",
    );
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

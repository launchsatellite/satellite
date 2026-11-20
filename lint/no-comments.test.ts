import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import { noComments } from "./no-comments.ts";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const error = [{ messageId: "comment" }];

new RuleTester().run("no-comments", noComments, {
  valid: [
    "const answer = 42;",
    "// eslint-disable-next-line no-console -- the CLI prints its result\nconsole.log(1);",
    "/* eslint-disable max-lines -- generated table */\nconst table = [];",
    "// @ts-expect-error -- the library types miss this overload\nconst value = 1;",
    "#!/usr/bin/env node\nconst answer = 42;",
  ],
  invalid: [
    { code: "// explain the next line\nconst answer = 42;", errors: error },
    { code: "/** jsdoc */\nconst answer = 42;", errors: error },
    { code: "// eslint-disable-next-line no-console\nconsole.log(1);", errors: error },
    { code: "// @ts-expect-error\nconst value = 1;", errors: error },
    { code: "// TODO later\nconst answer = 42;", errors: error },
  ],
});

import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import { noComments } from "./no-comments.ts";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const error = [{ messageId: "comment" }];
const jsx = { parserOptions: { ecmaFeatures: { jsx: true } } };

new RuleTester().run("no-comments", noComments, {
  valid: [
    "const answer = 42;",
    "// eslint-disable-next-line no-console -- the CLI prints its result\nconsole.log(1);",
    "/* eslint-disable max-lines -- generated table */\nconst table = [];",
    "// @ts-expect-error -- the library types miss this overload\nconst value = 1;",
    "#!/usr/bin/env node\nconst answer = 42;",
    "// eslint-disable-line no-console -- the CLI prints its result",
    "/* eslint-enable max-lines -- the generated table ends here */",
  ],
  invalid: [
    { code: "// explain the next line\nconst answer = 42;", errors: error },
    { code: "/** jsdoc */\nconst answer = 42;", errors: error },
    { code: "// eslint-disable-next-line no-console\nconsole.log(1);", errors: error },
    { code: "// @ts-expect-error\nconst value = 1;", errors: error },
    { code: "// TODO later\nconst answer = 42;", errors: error },
    { code: "/* plain block */\nconst answer = 42;", errors: error },
    { code: "const view = <div>{/* hi */}</div>;", languageOptions: jsx, errors: error },
    { code: "// eslint-disabled because -- prose smuggled\nconst a = 1;", errors: error },
    { code: "// @ts-expect-errorless -- prose smuggled\nconst a = 1;", errors: error },
    { code: "// eslint-enabled -- prose smuggled\nconst a = 1;", errors: error },
    {
      code: "/* eslint-disable satellite/no-comments -- docs below */\nconst a = 1;",
      errors: [
        { message: "Definition for rule 'satellite/no-comments' was not found." },
        { messageId: "comment" },
      ],
    },
  ],
});

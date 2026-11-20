import type { Rule } from "eslint";

const directivePrefixes = ["eslint-disable", "eslint-enable", "@ts-expect-error"];

function isShebang(comment: { type: string }): boolean {
  return comment.type === "Shebang";
}

function isReasonedDirective(text: string): boolean {
  const trimmed = text.trim();
  return (
    directivePrefixes.some((prefix) => trimmed.startsWith(prefix)) && / -- \s*\S/.test(trimmed)
  );
}

export const noComments: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    schema: [],
    messages: {
      comment:
        'Comments are not allowed. Let names and types carry the meaning, or give a tool directive its reason after " -- ".',
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (isShebang(comment) || isReasonedDirective(comment.value)) continue;
          context.report({ loc: comment.loc ?? { line: 1, column: 0 }, messageId: "comment" });
        }
      },
    };
  },
};

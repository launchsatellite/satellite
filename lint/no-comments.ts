import type { Rule } from "eslint";

const directive = /^(?:eslint-disable(?:-next-line|-line)?|eslint-enable|@ts-expect-error)(?:\s|$)/;
const reasonSeparator = " -- ";

function isShebang(comment: { type: string }): boolean {
  return comment.type === "Shebang";
}

function isReasonedDirective(text: string): boolean {
  const trimmed = text.trim();
  const separator = trimmed.indexOf(reasonSeparator);
  if (separator === -1) return false;
  const head = trimmed.slice(0, separator);
  const reason = trimmed.slice(separator + reasonSeparator.length).trim();
  return directive.test(head) && !head.includes("satellite/no-comments") && reason !== "";
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

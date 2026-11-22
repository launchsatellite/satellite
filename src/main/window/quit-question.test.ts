import { describe, expect, it } from "vitest";
import { quitButton, quitQuestion } from "./quit-question.ts";

describe("quitQuestion", () => {
  it("makes Cancel the answer Enter and Escape give", () => {
    const question = quitQuestion(2);
    expect(question.buttons?.[question.defaultId ?? -1]).toBe("Cancel");
    expect(question.buttons?.[question.cancelId ?? -1]).toBe("Cancel");
    expect(question.buttons?.[quitButton]).toBe("Quit Satellite");
  });

  it("keeps both answers plain buttons and counts the sessions", () => {
    expect(quitQuestion(1)).toMatchObject({
      noLink: true,
      message: "1 Claude Code session is running",
    });
    expect(quitQuestion(3).message).toBe("3 Claude Code sessions are running");
  });
});

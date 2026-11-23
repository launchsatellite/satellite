import { describe, expect, it } from "vitest";
import { asksToQuit, quitButton, quitQuestion, type QuitFacts } from "./quit-question.ts";

const quiet: QuitFacts = { sessions: 2, midTask: 0, unseen: 0, processes: 0 };

describe("asksToQuit", () => {
  it("lets idle and done sessions with nothing running end without a question", () => {
    expect(asksToQuit(quiet)).toBe(false);
    expect(asksToQuit({ sessions: 0, midTask: 0, unseen: 0, processes: null })).toBe(false);
  });

  it("asks for a session mid-task, one whose status is unseen and a running process", () => {
    expect(asksToQuit({ ...quiet, midTask: 1 })).toBe(true);
    expect(asksToQuit({ ...quiet, unseen: 1 })).toBe(true);
    expect(asksToQuit({ ...quiet, processes: 1 })).toBe(true);
  });

  it("asks when the running processes could not be read in time", () => {
    expect(asksToQuit({ ...quiet, processes: null })).toBe(true);
  });
});

describe("quitQuestion", () => {
  it("makes Cancel the answer Enter and Escape give", () => {
    const question = quitQuestion({ ...quiet, midTask: 2 });
    expect(question.buttons?.[question.defaultId ?? -1]).toBe("Cancel");
    expect(question.buttons?.[question.cancelId ?? -1]).toBe("Cancel");
    expect(question.buttons?.[quitButton]).toBe("Quit Satellite");
    expect(question.noLink).toBe(true);
  });

  it("names what stops with counts in one sentence", () => {
    expect(quitQuestion({ ...quiet, midTask: 1 }).message).toBe(
      "Quitting stops 1 Claude Code session mid-task.",
    );
    expect(quitQuestion({ ...quiet, processes: 3 }).message).toBe(
      "Quitting stops 3 processes Claude Code started.",
    );
    expect(quitQuestion({ sessions: 4, midTask: 2, unseen: 1, processes: 1 }).message).toBe(
      "Quitting stops 2 Claude Code sessions mid-task, 1 session whose status Satellite can't see and 1 process Claude Code started.",
    );
  });

  it("says when it could not check for running processes", () => {
    expect(quitQuestion({ ...quiet, unseen: 2, processes: null }).message).toBe(
      "Quitting stops 2 sessions whose status Satellite can't see and anything Claude Code started, which Satellite couldn't check in time.",
    );
  });
});

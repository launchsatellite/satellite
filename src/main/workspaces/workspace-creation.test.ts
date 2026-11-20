import { describe, expect, it, vi } from "vitest";
import type { CreationStep } from "../../shared/bridge-contract.ts";
import {
  runCreation,
  StepFailure,
  type CreationStepRun,
  type StepReport,
} from "./workspace-creation.ts";

const order: CreationStep[] = ["start", "branch", "worktree", "files", "save"];

interface Plan {
  fails?: CreationStep;
  error?: Error;
  undoAnswers?: Partial<Record<CreationStep, boolean | "throws">>;
  withoutUndo?: CreationStep[];
}

function fakeSteps(plan: Plan) {
  const calls: string[] = [];
  const steps: CreationStepRun[] = order.map((id) => {
    const answer = plan.undoAnswers?.[id] ?? true;
    const step: CreationStepRun = {
      id,
      run() {
        calls.push(`run ${id}`);
        if (plan.fails === id) {
          return Promise.reject(plan.error ?? new StepFailure(`${id} broke.`));
        }
        return Promise.resolve(`${id} done.`);
      },
    };
    if (plan.withoutUndo?.includes(id) === true) return step;
    return {
      ...step,
      undo() {
        calls.push(`undo ${id}`);
        if (answer === "throws") return Promise.reject(new Error("undo exploded"));
        return Promise.resolve(answer);
      },
    };
  });
  const reports: StepReport[] = [];
  return { steps, calls, reports, report: (event: StepReport) => reports.push(event) };
}

describe("runCreation", () => {
  it("runs every step in order and reports each", async () => {
    const { steps, calls, reports, report } = fakeSteps({});
    expect(await runCreation(steps, report)).toEqual({ ok: true });
    expect(calls).toEqual(order.map((id) => `run ${id}`));
    expect(reports).toEqual(
      order.flatMap((step) => [
        { step, state: "running", detail: null },
        { step, state: "done", detail: `${step} done.` },
      ]),
    );
  });

  it("undoes every started step backwards when one fails, the failed one first", async () => {
    const { steps, calls, reports, report } = fakeSteps({ fails: "files" });
    expect(await runCreation(steps, report)).toEqual({
      ok: false,
      step: "files",
      sentence: "files broke.",
      undone: true,
      left: null,
    });
    expect(calls).toEqual([
      "run start",
      "run branch",
      "run worktree",
      "run files",
      "undo files",
      "undo worktree",
      "undo branch",
      "undo start",
    ]);
    expect(reports.slice(-5)).toEqual([
      { step: "files", state: "failed", detail: null },
      { step: "files", state: "undone", detail: null },
      { step: "worktree", state: "undone", detail: null },
      { step: "branch", state: "undone", detail: null },
      { step: "start", state: "undone", detail: null },
    ]);
  });

  it("reports undone only for steps whose undo succeeded", async () => {
    const { steps, reports, report } = fakeSteps({
      fails: "worktree",
      undoAnswers: { worktree: false },
      withoutUndo: ["start"],
    });
    const result = await runCreation(steps, report);
    expect(result).toMatchObject({ ok: false, step: "worktree", undone: false });
    expect(reports.filter((event) => event.state === "undone")).toEqual([
      { step: "branch", state: "undone", detail: null },
    ]);
  });

  it("keeps undoing after an undo fails and says the undo was partial", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { steps, calls, report } = fakeSteps({
      fails: "save",
      undoAnswers: { files: "throws", worktree: false },
    });
    const result = await runCreation(steps, report);
    expect(result).toMatchObject({ ok: false, step: "save", undone: false });
    expect(calls.filter((call) => call.startsWith("undo"))).toEqual([
      "undo save",
      "undo files",
      "undo worktree",
      "undo branch",
      "undo start",
    ]);
    logged.mockRestore();
  });

  it("turns an unexpected error into the step's own sentence", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { steps, report } = fakeSteps({
      fails: "worktree",
      error: new Error("EACCES secret internals"),
    });
    const result = await runCreation(steps, report);
    expect(result).toEqual({
      ok: false,
      step: "worktree",
      sentence: "git couldn't check out the worktree, or one of the repository's hooks failed.",
      undone: true,
      left: null,
    });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

import type { CreationStep } from "../../shared/bridge-contract.ts";

export interface CreationStepRun {
  id: CreationStep;
  run(): Promise<string | null>;
  undo?: () => Promise<boolean>;
}
export interface StepReport {
  step: CreationStep;
  state: "running" | "done" | "failed" | "undone";
  detail: string | null;
}
export type CreationResult =
  { ok: true } | { ok: false; step: CreationStep; sentence: string; undone: boolean };

export class StepFailure extends Error {}

const unexpectedSentences: Record<CreationStep, string> = {
  start: "Something went wrong in Satellite. Try again.",
  branch: "git couldn't make the branch.",
  worktree: "git couldn't check out the worktree, or one of the repository's hooks failed.",
  files: "Satellite couldn't copy the files .worktreeinclude lists.",
  save: "Satellite couldn't save the workspace list.",
};

function sentenceFor(step: CreationStep, error: unknown): string {
  if (error instanceof StepFailure) return error.message;
  console.error(`Making a workspace failed in its ${step} step`, error);
  return unexpectedSentences[step];
}

async function undoOne(step: CreationStepRun): Promise<boolean> {
  if (step.undo === undefined) return true;
  try {
    return await step.undo();
  } catch (error) {
    console.error(`Undoing the ${step.id} step of a workspace failed`, error);
    return false;
  }
}

export async function runCreation(
  steps: readonly CreationStepRun[],
  report: (event: StepReport) => void,
): Promise<CreationResult> {
  const started: CreationStepRun[] = [];
  for (const step of steps) {
    started.unshift(step);
    report({ step: step.id, state: "running", detail: null });
    let detail: string | null;
    try {
      detail = await step.run();
    } catch (error) {
      report({ step: step.id, state: "failed", detail: null });
      const sentence = sentenceFor(step.id, error);
      let undone = true;
      for (const undoing of started) {
        const answered = await undoOne(undoing);
        if (answered && undoing.undo !== undefined) {
          report({ step: undoing.id, state: "undone", detail: null });
        }
        undone &&= answered;
      }
      return { ok: false, step: step.id, sentence, undone };
    }
    report({ step: step.id, state: "done", detail });
  }
  return { ok: true };
}

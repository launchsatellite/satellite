import type { CreationStep } from "../../shared/bridge-contract.ts";

export interface CreationStepRun {
  id: CreationStep;
  run(): Promise<string | null>;
  undo?: () => Promise<boolean | string>;
}
export interface StepReport {
  step: CreationStep;
  state: "running" | "done" | "failed" | "undone";
  detail: string | null;
}
export type CreationResult =
  | { ok: true }
  | { ok: false; step: CreationStep; sentence: string; undone: boolean; left: string | null };

export class StepFailure extends Error {
  detail: string | null;
  constructor(sentence: string, detail: string | null = null) {
    super(sentence);
    this.detail = detail;
  }
}

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

async function undoOne(step: CreationStepRun): Promise<boolean | string> {
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
      const detail = error instanceof StepFailure ? error.detail : null;
      report({ step: step.id, state: "failed", detail });
      const sentence = sentenceFor(step.id, error);
      let undone = true;
      let left: string | null = null;
      for (const undoing of started) {
        const answered = await undoOne(undoing);
        if (answered === true && undoing.undo !== undefined) {
          report({ step: undoing.id, state: "undone", detail: null });
        }
        if (typeof answered === "string") left ??= answered;
        undone &&= answered === true;
      }
      return { ok: false, step: step.id, sentence, undone, left };
    }
    report({ step: step.id, state: "done", detail });
  }
  return { ok: true };
}

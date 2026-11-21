import type { PixelState } from "../ui/status-pixel.tsx";

export type GuideStep = 1 | 2 | 3 | 4;
export type GuideSide = "right" | "left" | "below";
export interface GuideFacts {
  workspaces: number;
  sessions: number;
}
interface GuideStepDetail {
  anchor: "workspace" | "session" | "views" | "inbox";
  side: GuideSide;
  title: string;
  text: string;
  band?: { height: number; below: number };
}

export const guideSteps: Record<GuideStep, GuideStepDetail> = {
  1: {
    anchor: "workspace",
    side: "right",
    title: "make a workspace",
    text: "A workspace is a git worktree and a branch made in one step, so agents work side by side and never in each other's files.",
  },
  2: {
    anchor: "session",
    side: "left",
    title: "start Claude Code",
    text: "This is your own Claude Code in a real terminal, with your settings and skills, and its prompt is the only place you type.",
  },
  3: {
    anchor: "views",
    side: "below",
    title: "read what it did",
    text: "Changes, Files and Pull request show the work in this workspace, read only, because your agent does the writing.",
  },
  4: {
    anchor: "inbox",
    side: "right",
    title: "orange means you",
    text: "A square pixel shows the state of each session, and signal orange means one cannot go on without you, so it waits in the inbox.",
    band: { height: 28, below: 2 },
  },
};
export const guideLegend: readonly { state: PixelState; word: string }[] = [
  { state: "idle", word: "idle" },
  { state: "working", word: "working" },
  { state: "needs-you", word: "needs you" },
  { state: "done", word: "done" },
];
export const guideClosedSentence =
  "The guide is closed. Show the guide in the command menu opens it again.";

const following: Record<GuideStep, GuideStep> = { 1: 2, 2: 3, 3: 4, 4: 4 };

export function stepReadout(step: GuideStep): string {
  return `0${String(step)} / 04`;
}

export function stepSpoken(step: GuideStep): string {
  return `Step ${String(step)} of 4`;
}

export function settledStep(step: GuideStep, facts: GuideFacts): GuideStep {
  if (step === 1 && facts.workspaces > 0) return settledStep(2, facts);
  if (step === 2 && facts.sessions > 0) return 3;
  return step;
}

export function stepAfter(step: GuideStep, facts: GuideFacts): GuideStep {
  return settledStep(following[step], facts);
}

import { noticeName } from "../../shared/notice-name.ts";
import type { Needing } from "./notices.ts";

export interface NoticeSubject {
  project: string;
  parent: string | null;
  workspace: string | null;
}
export interface NoticeText {
  title: string;
  body: string;
}

export const noticeParentLimit = 16;

export function noticeText(
  subjects: readonly [NoticeSubject, ...NoticeSubject[]],
  waiting: number,
  reason: Needing["reason"] = "session",
): NoticeText {
  if (subjects.length > 1 || waiting > 1) {
    return {
      title: `${String(Math.max(waiting, subjects.length))} workspaces need you`,
      body: "Open Satellite to answer them from the inbox.",
    };
  }
  const { workspace, parent } = subjects[0];
  const name = noticeName(subjects[0].project, "a project");
  const project =
    parent === null ? name : `${name} in ${noticeName(parent, "a folder", noticeParentLimit)}`;
  if (workspace === null) {
    return {
      title: `${project} needs you`,
      body:
        reason === "pull-request"
          ? "The pull request in the main workspace needs you."
          : "Claude Code is waiting for you in the main workspace.",
    };
  }
  return {
    title: `${noticeName(workspace, "a workspace")} needs you`,
    body:
      reason === "pull-request"
        ? `The pull request needs you in ${project}.`
        : `Claude Code is waiting for you in ${project}.`,
  };
}

export interface NoticeSubject {
  project: string;
  workspace: string | null;
}
export interface NoticeText {
  title: string;
  body: string;
}

export const noticeNameLimit = 32;

const outsideName = /[^\p{L}\p{M}\p{N} ._+()-]|\p{Default_Ignorable_Code_Point}/gu;
const spaces = / +/g;

export function noticeName(raw: string, fallback: string): string {
  const spaced = raw.replace(outsideName, " ").replace(spaces, " ").trim();
  const cut = Array.from(spaced).slice(0, noticeNameLimit).join("").trim();
  return cut === "" ? fallback : cut;
}

export function noticeText(subjects: readonly [NoticeSubject, ...NoticeSubject[]]): NoticeText {
  if (subjects.length > 1) {
    return {
      title: `${String(subjects.length)} workspaces need you`,
      body: "Open Satellite to answer them from the inbox.",
    };
  }
  const project = noticeName(subjects[0].project, "a project");
  const { workspace } = subjects[0];
  if (workspace === null) {
    return {
      title: `${project} needs you`,
      body: "Claude Code is waiting for you in the main workspace.",
    };
  }
  return {
    title: `${noticeName(workspace, "a workspace")} needs you`,
    body: `Claude Code is waiting for you in ${project}.`,
  };
}

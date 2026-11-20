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
const leadingMarks = /^\p{M}+/u;
const letterOrDigit = /[\p{L}\p{N}]/u;
const rawLimit = 1024;
const clusters = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function cutToLimit(text: string): string {
  let cut = "";
  let points = 0;
  for (const { segment } of clusters.segment(text)) {
    points += Array.from(segment).length;
    if (points > noticeNameLimit) break;
    cut += segment;
  }
  return cut;
}

export function noticeName(raw: string, fallback: string): string {
  const spaced = raw
    .slice(0, rawLimit)
    .replace(outsideName, " ")
    .replace(spaces, " ")
    .trim()
    .replace(leadingMarks, "")
    .trim();
  const cut = cutToLimit(spaced).trim();
  return letterOrDigit.test(cut) ? cut : fallback;
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

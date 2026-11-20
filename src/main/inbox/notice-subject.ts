import type { WorkspaceRef } from "../../shared/bridge-contract.ts";
import { projectName, type ProjectStore } from "../projects/project-list.ts";
import type { NoticeSubject } from "./notice-text.ts";

export async function noticeSubject(
  store: ProjectStore,
  ref: WorkspaceRef,
): Promise<NoticeSubject | undefined> {
  const project = await store.project(ref.projectId).catch(() => undefined);
  if (project === undefined) return undefined;
  const name = projectName(project.path);
  if (ref.workspace === "main") return { project: name, workspace: null };
  const record = project.workspaces.find((workspace) => workspace.id === ref.workspace);
  return record === undefined ? undefined : { project: name, workspace: record.name };
}

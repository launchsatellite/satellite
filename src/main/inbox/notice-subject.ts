import type { WorkspaceRef } from "../../shared/bridge-contract.ts";
import { repeatedNames, shownParent } from "../../shared/project-names.ts";
import type { StoredProject } from "../projects/projects-file.ts";
import { parentName, projectName, type ProjectStore } from "../projects/project-list.ts";
import type { NoticeSubject } from "./notice-text.ts";

function named({ path }: StoredProject): { name: string; parent: string } {
  return { name: projectName(path), parent: parentName(path) };
}

export async function noticeSubject(
  store: ProjectStore,
  ref: WorkspaceRef,
): Promise<NoticeSubject | undefined> {
  const listed = await store.list();
  const project = listed.find(({ id }) => id === ref.projectId);
  if (project === undefined) return undefined;
  const { name } = named(project);
  const parent = shownParent(named(project), repeatedNames(listed.map(named))) ?? null;
  if (ref.workspace === "main") return { project: name, parent, workspace: null };
  const record = project.workspaces.find((workspace) => workspace.id === ref.workspace);
  return record === undefined ? undefined : { project: name, parent, workspace: record.name };
}

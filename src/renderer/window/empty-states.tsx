import type { ReactNode } from "react";
import type { ProjectView } from "../../shared/bridge-contract.ts";
import { commandShortcut, useCommands } from "../commands/commands-context.tsx";

function Centred({
  testId,
  title,
  children,
}: {
  testId: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div data-testid={testId} className="max-w-[320px] text-center">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function NothingSelected() {
  const switcher = useCommands().get("palette.switcher");
  const shortcut = switcher === undefined ? undefined : commandShortcut(switcher);
  return (
    <Centred testId="nothing-selected" title="Pick a workspace">
      <p className="mt-1 text-[13px] text-fg2">
        {shortcut === undefined
          ? "Choose one on the left."
          : `Choose one on the left, or press ${shortcut} to jump straight to it.`}
      </p>
    </Centred>
  );
}

export function FolderMissing({
  name,
  parent,
  missing,
  worktrees,
  workspaces,
}: {
  name: string;
  parent: string;
  missing: NonNullable<ProjectView["missing"]>;
  worktrees: string | undefined;
  workspaces: number;
}) {
  const kept =
    worktrees === undefined || workspaces === 0
      ? ""
      : workspaces === 1
        ? ` Its workspace's folder stays in ${worktrees} in the Satellite home.`
        : ` Its workspaces' folders stay in ${worktrees} in the Satellite home.`;
  return missing === "folder" ? (
    <Centred testId="folder-missing" title={`${name} isn't where it was`}>
      <p className="mt-1 text-[13px] text-fg2">
        {parent === ""
          ? `Put the folder back and Satellite finds it again, or remove the project.${kept}`
          : `Put it back in ${parent} and Satellite finds it again, or remove the project.${kept}`}
      </p>
    </Centred>
  ) : (
    <Centred testId="folder-missing" title={`${name} isn't a repository anymore`}>
      <p className="mt-1 text-[13px] text-fg2">
        The folder is still there, but it is no longer a git repository. Make it one again and
        Satellite finds it, or remove the project.{kept}
      </p>
    </Centred>
  );
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { BridgeResponse, ProjectView, WorkspaceView } from "../../shared/bridge-contract.ts";
import { invoke } from "../bridge/bridge-client.ts";
import { Button } from "../ui/button.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { StatusPixel, type PixelState } from "../ui/status-pixel.tsx";

type Inspected = BridgeResponse<"workspaces.inspect">;
type Phase =
  | { kind: "checking" }
  | { kind: "unreadable"; message: string; failure: string | null }
  | { kind: "ready"; view: Inspected; notice: boolean; failure: string | null }
  | { kind: "archiving"; view: Inspected; notice: boolean };

interface ArchiveDialogProps {
  project: ProjectView;
  workspace: WorkspaceView;
  onClose: () => void;
  onArchived: (leftover: string | null) => void;
}

const list = "max-h-[160px] overflow-y-auto pl-4 font-mono text-[12px] text-fg2";

function changedSentence(name: string): string {
  return `Something changed in ${name} since you looked. Here is the latest.`;
}

function Row({
  pixel,
  testId,
  children,
}: {
  pixel: PixelState;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div data-testid={testId} className="flex min-h-8 items-start gap-[10px] py-[6px] text-[13px]">
      <span className="mt-[6px] flex flex-none">
        <StatusPixel state={pixel} />
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function Files({ view }: { view: Inspected }) {
  const count = view.files.length + view.moreFiles;
  if (count === 0) {
    return (
      <div data-testid="archive-files">
        <Row pixel="ready">Nothing uncommitted.</Row>
      </div>
    );
  }
  return (
    <div data-testid="archive-files">
      <Row pixel="needs-you">
        {count === 1
          ? "1 file isn't committed and will be deleted."
          : `${String(count)} files aren't committed and will be deleted.`}
      </Row>
      <ul className={list}>
        {view.files.map((file) => (
          <li key={file.path} className="break-all whitespace-pre-wrap">
            {file.code} {file.path}
          </li>
        ))}
        {view.moreFiles > 0 && <li>and {String(view.moreFiles)} more</li>}
      </ul>
    </div>
  );
}

function commitsRow(view: Inspected): { pixel: PixelState; text: string; subjects: string[] } {
  const branch = view.branch ?? "";
  const { commits } = view;
  switch (commits.kind) {
    case "unpushed":
      if (commits.count === 0)
        return { pixel: "ready", text: "Every commit is pushed.", subjects: [] };
      return {
        pixel: "idle",
        text:
          commits.count === 1
            ? `1 commit isn't pushed. The branch ${branch} keeps it.`
            : `${String(commits.count)} commits aren't pushed. The branch ${branch} keeps them.`,
        subjects: commits.subjects,
      };
    case "lost":
      if (commits.count === 0) {
        return { pixel: "ready", text: "Every commit is on a branch.", subjects: [] };
      }
      return {
        pixel: "needs-you",
        text:
          commits.count === 1
            ? "1 commit isn't on any branch and will be lost."
            : `${String(commits.count)} commits aren't on any branch and will be lost.`,
        subjects: commits.subjects,
      };
    case "no-remote":
      return {
        pixel: "idle",
        text: `This repository has no remote, so nothing here is pushed. The branch ${branch} keeps every commit.`,
        subjects: [],
      };
    case "unknown":
      return {
        pixel: "needs-you",
        text:
          view.branch === null
            ? "Satellite couldn't tell whether the commits here are on a branch, so some may be lost."
            : `Satellite couldn't count the commits that aren't pushed, so it can't rule out a loss. The branch ${branch} stays.`,
        subjects: [],
      };
  }
}

function Commits({ view }: { view: Inspected }) {
  const { pixel, text, subjects } = commitsRow(view);
  return (
    <div data-testid="archive-commits">
      <Row pixel={pixel}>{text}</Row>
      {subjects.length > 0 && (
        <ul className={list}>
          {subjects.map((subject, index) => (
            <li key={index} className="break-words">
              {subject}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function losesWork(view: Inspected): boolean {
  const { commits } = view;
  return (
    view.files.length + view.moreFiles > 0 ||
    view.repositories > 0 ||
    view.hidden !== 0 ||
    commits.kind === "unknown" ||
    (commits.kind === "lost" && commits.count > 0)
  );
}

function hiddenSentence(hidden: number | null): string {
  if (hidden === null) {
    return "Satellite couldn't check for files git leaves out of its status, so it can't rule out losing changes there.";
  }
  return hidden === 1
    ? "1 file is marked for git to skip, so its changes aren't listed above and would be deleted."
    : `${String(hidden)} files are marked for git to skip, so their changes aren't listed above and would be deleted.`;
}

function repositoriesSentence(count: number): string {
  return count === 1
    ? "1 folder here is a repository of its own, and its whole history is deleted with it."
    : `${String(count)} folders here are repositories of their own, and their whole history is deleted with them.`;
}

function submodulesSentence(name: string, submodules: Inspected["submodules"]): string {
  return submodules === "checked-out"
    ? `${name} has submodules checked out, and git would delete their own history with it, so Satellite won't archive it.`
    : `Satellite couldn't check whether ${name} has submodules checked out, so it won't archive it.`;
}

function boundarySentence(name: string, boundary: Inspected["boundary"]): string {
  switch (boundary.kind) {
    case "clear":
      return "";
    case "mount":
      return `${name} holds a folder from another drive at ${boundary.at}, so Satellite won't archive it. Unmount it first.`;
    case "unchecked":
      switch (boundary.why) {
        case "unreadable":
          return `Satellite can't read every folder in ${name}, so it can't rule out a folder from another drive there and won't archive it. Make its folders readable, then try again.`;
        case "limits":
          return `${name} holds more than Satellite checks for links and folders from another drive, so it won't archive it. Check that it holds no folder from another drive, then remove it with git worktree remove in a terminal.`;
        case "late":
          return `A folder in ${name} didn't answer within 60 seconds, so Satellite won't archive it. Check the drives mounted inside it, then try again.`;
      }
  }
}

function blocked(view: Inspected): boolean {
  return view.locked || view.submodules !== "none" || view.boundary.kind !== "clear";
}

export function ArchiveDialog({ project, workspace, onClose, onArchived }: ArchiveDialogProps) {
  const name = workspace.name ?? project.name;
  const projectId = project.id;
  const workspaceId = workspace.key;
  const alive = useRef(true);
  const submitting = useRef(false);
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });

  const read = useCallback(
    (notice: boolean, failure: string | null) => {
      void invoke("workspaces.inspect", { projectId, workspaceId }).then((result) => {
        if (!alive.current) return;
        setPhase(
          result.ok
            ? { kind: "ready", view: result.value, notice, failure }
            : { kind: "unreadable", message: result.error.message, failure },
        );
      });
    },
    [projectId, workspaceId],
  );

  useLayoutEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLButtonElement && active.closest("[role='dialog']") !== null) return;
    document.querySelector<HTMLElement>("[data-testid='archive-cancel']")?.focus();
  }, [phase.kind]);

  useEffect(() => {
    alive.current = true;
    read(false, null);
    return () => {
      alive.current = false;
    };
  }, [read]);

  const archive = () => {
    if (phase.kind !== "ready" || blocked(phase.view) || submitting.current) return;
    submitting.current = true;
    const { view, notice } = phase;
    setPhase({ kind: "archiving", view, notice });
    void invoke("workspaces.archive", {
      projectId,
      workspaceId,
      fingerprint: view.fingerprint,
    }).then((result) => {
      submitting.current = false;
      if (!alive.current) return;
      if (result.ok) {
        onArchived(result.value.leftover);
        return;
      }
      const changed =
        result.error.code === "refused" && result.error.message === changedSentence(name);
      setPhase({ kind: "checking" });
      read(changed || notice, changed ? null : result.error.message);
    });
  };

  const body = () => {
    if (phase.kind === "checking") {
      return (
        <p role="status" className="text-[13px] text-dim">
          Checking {name}…
        </p>
      );
    }
    if (phase.kind === "unreadable") {
      return (
        <p role="alert" data-testid="archive-failure" className="text-[13px] text-sigfg">
          {phase.failure === null ? phase.message : `${phase.failure} ${phase.message}`}
        </p>
      );
    }
    const { view } = phase;
    return (
      <>
        {phase.notice && (
          <p role="status" data-testid="archive-notice" className="text-[13px] text-fg2">
            {changedSentence(name)}
          </p>
        )}
        <div className="flex flex-col gap-1">
          <Files view={view} />
          {view.repositories > 0 && (
            <Row pixel="needs-you" testId="archive-repositories">
              {repositoriesSentence(view.repositories)}
            </Row>
          )}
          {view.hidden !== 0 && (
            <Row pixel="needs-you" testId="archive-hidden">
              {hiddenSentence(view.hidden)}
            </Row>
          )}
          <Commits view={view} />
          {view.sessions > 0 && (
            <Row pixel="idle" testId="archive-sessions">
              {view.sessions === 1
                ? "1 Claude Code session running here stops first."
                : `${String(view.sessions)} Claude Code sessions running here stop first.`}
            </Row>
          )}
          <Row pixel="idle">
            Files git ignores, like dependencies and build output, are deleted with the folder.
            Links to other folders are removed, and what they point to stays.
          </Row>
          {view.submodules !== "none" && (
            <Row pixel="needs-you" testId="archive-submodules">
              {submodulesSentence(name, view.submodules)}
            </Row>
          )}
          {view.boundary.kind !== "clear" && (
            <Row pixel="needs-you" testId="archive-boundary">
              {boundarySentence(name, view.boundary)}
            </Row>
          )}
          {view.locked && (
            <Row pixel="needs-you" testId="archive-locked">
              {name} is locked in git, so Satellite won&apos;t archive it. Run git worktree unlock
              on it first.
            </Row>
          )}
        </div>
        {phase.kind === "ready" && phase.failure !== null && (
          <p role="alert" data-testid="archive-failure" className="text-[13px] text-sigfg">
            {phase.failure}
          </p>
        )}
      </>
    );
  };

  const footer = () => {
    if (phase.kind === "unreadable") {
      return (
        <>
          <Button variant="ghost" onClick={onClose} testId="archive-cancel">
            Close
          </Button>
          <Button
            onClick={() => {
              setPhase({ kind: "checking" });
              read(false, null);
            }}
            testId="archive-retry"
          >
            Try again
          </Button>
        </>
      );
    }
    const view = phase.kind === "checking" ? undefined : phase.view;
    const archiving = phase.kind === "archiving";
    return (
      <>
        <span className="mr-auto">
          <Button variant="ghost" onClick={onClose} disabled={archiving} testId="archive-cancel">
            Cancel
          </Button>
        </span>
        {view !== undefined && (
          <Button
            variant={losesWork(view) ? "danger" : "primary"}
            onClick={archive}
            disabled={archiving || blocked(view)}
            testId="archive-confirm"
          >
            {archiving ? "Archiving…" : losesWork(view) ? "Archive anyway" : "Archive workspace"}
          </Button>
        )}
      </>
    );
  };

  return (
    <Dialog
      title={`Archive ${name}`}
      description="Here is what happens to the work in this worktree."
      testId="archive-dialog"
      onClose={onClose}
      closable={phase.kind !== "archiving"}
      footer={footer()}
    >
      {body()}
    </Dialog>
  );
}

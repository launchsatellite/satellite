import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { BridgeResponse, ProjectView, WorkspaceView } from "../../shared/bridge-contract.ts";
import { invoke } from "../bridge/bridge-client.ts";
import { Button } from "../ui/button.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { StatusPixel } from "../ui/status-pixel.tsx";

type Inspected = BridgeResponse<"workspaces.inspect">;
type Phase =
  | { kind: "checking" }
  | { kind: "unreadable"; message: string }
  | { kind: "ready"; view: Inspected; notice: boolean; failure: string | null }
  | { kind: "archiving"; view: Inspected; notice: boolean };
type PixelState = "idle" | "ready" | "needs-you";

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
    <div data-testid={testId} className="flex min-h-8 items-center gap-[10px] text-[13px]">
      <StatusPixel state={pixel} />
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
        pixel: "idle",
        text: "Satellite couldn't count the commits that aren't pushed.",
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
  const lostCommits = view.commits.kind === "lost" && view.commits.count > 0;
  return view.files.length + view.moreFiles > 0 || lostCommits;
}

export function ArchiveDialog({ project, workspace, onClose, onArchived }: ArchiveDialogProps) {
  const name = workspace.name ?? project.name;
  const projectId = project.id;
  const workspaceId = workspace.key;
  const alive = useRef(true);
  const submitting = useRef(false);
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });

  const read = useCallback(
    (notice: boolean) => {
      void invoke("workspaces.inspect", { projectId, workspaceId }).then((result) => {
        if (!alive.current) return;
        setPhase(
          result.ok
            ? { kind: "ready", view: result.value, notice, failure: null }
            : { kind: "unreadable", message: result.error.message },
        );
      });
    },
    [projectId, workspaceId],
  );

  useEffect(() => {
    alive.current = true;
    read(false);
    return () => {
      alive.current = false;
    };
  }, [read]);

  const archive = () => {
    if (phase.kind !== "ready" || phase.view.locked || submitting.current) return;
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
      if (result.error.code === "refused" && result.error.message === changedSentence(name)) {
        setPhase({ kind: "checking" });
        read(true);
        return;
      }
      setPhase({ kind: "ready", view, notice, failure: result.error.message });
    });
  };

  const body = () => {
    if (phase.kind === "checking") {
      return <p className="text-[13px] text-dim">Checking {name}…</p>;
    }
    if (phase.kind === "unreadable") {
      return (
        <p role="alert" data-testid="archive-failure" className="text-[13px] text-sigfg">
          {phase.message}
        </p>
      );
    }
    const { view } = phase;
    return (
      <>
        {phase.notice && (
          <p data-testid="archive-notice" className="text-[13px] text-fg2">
            {changedSentence(name)}
          </p>
        )}
        <div className="flex flex-col gap-[2px]">
          <Files view={view} />
          <Commits view={view} />
          {view.sessions > 0 && (
            <Row pixel="idle" testId="archive-sessions">
              {view.sessions === 1
                ? "1 Claude Code terminal running here stops first."
                : `${String(view.sessions)} Claude Code terminals running here stop first.`}
            </Row>
          )}
          <Row pixel="idle">
            Files git ignores, like dependencies and build output, are deleted with the folder.
          </Row>
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
        <Button variant="ghost" onClick={onClose} testId="archive-cancel">
          Close
        </Button>
      );
    }
    const view = phase.kind === "checking" ? undefined : phase.view;
    const archiving = phase.kind === "archiving";
    return (
      <>
        <span className="mr-auto">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={archiving}
            testId="archive-cancel"
            autoFocus
          >
            Cancel
          </Button>
        </span>
        {view !== undefined && (
          <Button
            variant={losesWork(view) ? "danger" : "primary"}
            onClick={archive}
            disabled={archiving || view.locked}
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

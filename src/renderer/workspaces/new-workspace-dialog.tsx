import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type {
  BridgeResponse,
  CreationStep,
  ProjectView,
  StartChoice,
  StartView,
  WorkspaceView,
} from "../../shared/bridge-contract.ts";
import { visibleText } from "../../shared/visible-text.ts";
import { workspaceNameLimit, workspaceNameProblem } from "../../shared/workspace-name.ts";
import { invoke, subscribe } from "../bridge/bridge-client.ts";
import { Button } from "../ui/button.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { StatusPixel, type PixelState } from "../ui/status-pixel.tsx";
import { visibleLabel } from "../ui/visible-name.tsx";

type Prepared = BridgeResponse<"workspaces.prepare">;
type StepState = "pending" | "running" | "done" | "failed" | "undone";
type Phase =
  | { kind: "reading" }
  | { kind: "unavailable"; message: string }
  | { kind: "form"; prepared: Prepared }
  | { kind: "running"; prepared: Prepared; operationId: string; stopping: boolean }
  | { kind: "failed"; prepared: Prepared; message: string; stopped: boolean };
type Steps = Record<CreationStep, { state: StepState; detail: string | null }>;

interface NewWorkspaceDialogProps {
  project: ProjectView;
  onClose: () => void;
  onCreated: (workspace: WorkspaceView) => void;
}

const stepOrder: readonly CreationStep[] = ["start", "branch", "worktree", "files", "save"];
const defaultStart = "default";
const undoneSteps: readonly CreationStep[] = ["branch", "worktree", "files"];
const field =
  "h-8 rounded-[8px] border border-ctl bg-side px-[10px] text-[13px] text-fg outline-none focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)] disabled:opacity-[0.38]";
const fieldLabel = "text-[12px] font-semibold text-fg2";
const readout = "ml-auto font-pixel text-[12px] text-dim uppercase";
const pixels: Record<StepState, PixelState> = {
  pending: "idle",
  running: "working",
  done: "done",
  failed: "needs-you",
  undone: "idle",
};
const readouts: Record<StepState, string | null> = {
  pending: null,
  running: "Running",
  done: "✓",
  failed: "Failed",
  undone: "Undone",
};

function pendingSteps(): Steps {
  const entry: Steps[CreationStep] = { state: "pending", detail: null };
  return { start: entry, branch: entry, worktree: entry, files: entry, save: entry };
}

function settled(entry: Steps[CreationStep]): Steps[CreationStep] {
  return entry.state === "failed" ? { ...entry, state: "undone" } : entry;
}

function stepTitle(step: CreationStep, name: string): string {
  switch (step) {
    case "start":
      return "Find the starting point";
    case "branch":
      return `Make the branch ${name}`;
    case "worktree":
      return "Check out the worktree";
    case "files":
      return "Copy the files .worktreeinclude lists";
    case "save":
      return "Add the workspace to Satellite";
  }
}

function defaultLabel(start: StartView, project: string): string {
  if (start.kind === "remote") {
    return `Latest ${start.branch ?? "default branch"} from ${start.remote}`;
  }
  if (start.kind === "local" && start.branch !== null) {
    return `${start.branch}, where ${project} is now`;
  }
  return `The commit ${project} is on now`;
}

function otherStarts<T extends { ref: string }>(branches: readonly T[], start: StartView): T[] {
  if (start.kind !== "local" || start.branch === null) return [...branches];
  const current = `refs/heads/${start.branch}`;
  return branches.filter((branch) => branch.ref !== current);
}

function chosenStart(value: string): StartChoice {
  return value === defaultStart ? { kind: "default" } : { kind: "ref", ref: value };
}

function StepRows({ steps, name }: { steps: Steps; name: string }) {
  return (
    <ol
      data-testid="workspace-steps"
      aria-live="polite"
      aria-label="Steps"
      className="flex-none overflow-hidden rounded-[10px] border border-line"
    >
      {stepOrder.map((step) => {
        const { state, detail } = steps[step];
        const shown = readouts[state];
        const look =
          state === "running"
            ? "bg-side font-semibold text-fg"
            : state === "pending"
              ? "text-dim"
              : "text-fg";
        return (
          <li
            key={step}
            data-testid={`step-${step}`}
            className={`flex min-h-[42px] items-center gap-[10px] border-t border-line px-[14px] text-[13px] first:border-t-0 ${look}`}
          >
            <StatusPixel state={pixels[state]} />
            <span className="flex min-w-0 flex-col py-2">
              <span className="break-words">{stepTitle(step, name)}</span>
              {detail !== null && state !== "failed" && (
                <span className="text-[12px] font-normal break-words text-dim">
                  {visibleText(detail)}
                </span>
              )}
            </span>
            {shown === "✓" ? (
              <span className={readout}>
                <span aria-hidden="true">✓</span>
                <span className="sr-only">Done</span>
              </span>
            ) : (
              shown !== null && <span className={readout}>{shown}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function NewWorkspaceDialog({ project, onClose, onCreated }: NewWorkspaceDialogProps) {
  const nameId = useId();
  const problemId = useId();
  const startId = useId();
  const input = useRef<HTMLInputElement>(null);
  const failure = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const stopping = useRef(false);
  const unsubscribe = useRef<(() => void) | undefined>(undefined);
  const alive = useRef(true);
  const [phase, setPhase] = useState<Phase>({ kind: "reading" });
  const [name, setName] = useState("");
  const [start, setStart] = useState(defaultStart);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [steps, setSteps] = useState<Steps>(pendingSteps);
  const projectId = project.id;
  const projectName = visibleText(project.name);

  useEffect(() => {
    alive.current = true;
    void invoke("workspaces.prepare", { projectId }).then((result) => {
      if (!alive.current) return;
      if (!result.ok) {
        setPhase({ kind: "unavailable", message: result.error.message });
        return;
      }
      setName(result.value.name);
      setPhase({ kind: "form", prepared: result.value });
    });
    return () => {
      alive.current = false;
      unsubscribe.current?.();
    };
  }, [projectId]);

  const failedDetail =
    stepOrder
      .map((step) => steps[step])
      .find((entry) => entry.state === "failed" && entry.detail !== null)?.detail ?? undefined;
  useLayoutEffect(() => {
    if (phase.kind === "form") {
      input.current?.focus();
      input.current?.select();
    }
  }, [phase.kind]);
  useLayoutEffect(() => {
    if (phase.kind === "failed") failure.current?.scrollIntoView({ block: "end" });
  }, [phase.kind, failedDetail]);

  const problem = workspaceNameProblem(name);
  const canCreate =
    phase.kind === "form" && problem === null && phase.prepared.start.kind !== "empty";

  const create = () => {
    if (!canCreate || submitting.current) return;
    submitting.current = true;
    stopping.current = false;
    const operationId = crypto.randomUUID();
    let reported = false;
    const started = new Set<CreationStep>();
    const undone = new Set<CreationStep>();
    setRefusal(null);
    setSteps(pendingSteps());
    setPhase({ kind: "running", prepared: phase.prepared, operationId, stopping: false });
    unsubscribe.current = subscribe("workspaces.step", (event) => {
      if (event.operationId !== operationId) return;
      reported = true;
      if (event.state === "running") started.add(event.step);
      if (event.state === "undone") undone.add(event.step);
      setSteps((current) => {
        const before = current[event.step];
        const keepsFailure = before.state === "failed" && event.state === "undone";
        return {
          ...current,
          [event.step]: {
            state: keepsFailure ? "failed" : event.state,
            detail: event.detail ?? before.detail,
          },
        };
      });
    });
    void invoke("workspaces.create", {
      operationId,
      projectId,
      name,
      start: chosenStart(start),
    }).then((result) => {
      unsubscribe.current?.();
      unsubscribe.current = undefined;
      if (!alive.current) return;
      if (result.ok) {
        onCreated(result.value.workspace);
        return;
      }
      submitting.current = false;
      if (reported) {
        const stopped =
          stopping.current &&
          [...started].every((step) => !undoneSteps.includes(step) || undone.has(step));
        if (stopped) {
          setSteps((current) => ({
            start: settled(current.start),
            branch: settled(current.branch),
            worktree: settled(current.worktree),
            files: settled(current.files),
            save: settled(current.save),
          }));
        }
        setPhase({
          kind: "failed",
          prepared: phase.prepared,
          message: result.error.message,
          stopped,
        });
        return;
      }
      setRefusal(result.error.message);
      setPhase({ kind: "form", prepared: phase.prepared });
    });
  };

  const stopCreation = () => {
    if (phase.kind !== "running" || phase.stopping) return;
    stopping.current = true;
    setPhase({ ...phase, stopping: true });
    void invoke("workspaces.cancel", { operationId: phase.operationId, projectId });
  };

  const pressInName = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    create();
  };

  const body = () => {
    if (phase.kind === "reading") {
      return <p className="text-[13px] break-words text-dim">Reading {projectName}…</p>;
    }
    if (phase.kind === "unavailable") {
      return (
        <p role="alert" data-testid="workspace-failure" className="text-[13px] text-danger">
          {visibleText(phase.message)}
        </p>
      );
    }
    const locked = phase.kind !== "form";
    const shownProblem = refusal ?? problem;
    const startView = phase.prepared.start;
    return (
      <>
        <div className="flex flex-col gap-[6px]">
          <label htmlFor={nameId} className={fieldLabel}>
            Name
          </label>
          <input
            ref={input}
            id={nameId}
            data-testid="workspace-name"
            className={`${field} font-mono`}
            value={name}
            maxLength={workspaceNameLimit}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            disabled={locked}
            aria-invalid={shownProblem !== null}
            aria-describedby={problemId}
            onChange={(event) => {
              setName(event.target.value);
              setRefusal(null);
            }}
            onKeyDown={pressInName}
          />
          <p
            key={refusal ?? "typed"}
            id={problemId}
            data-testid="workspace-name-problem"
            role={refusal === null ? undefined : "alert"}
            className={`text-[12px] ${shownProblem === null ? "text-dim" : "text-danger"}`}
          >
            {visibleText(shownProblem ?? "The branch takes the same name.")}
          </p>
        </div>
        {startView.kind === "empty" ? (
          <p data-testid="workspace-start-note" className="text-[13px] text-fg2">
            {projectName} has no commits yet. Make a first commit, then make a workspace.
          </p>
        ) : (
          <div className="flex flex-col gap-[6px]">
            <label htmlFor={startId} className={fieldLabel}>
              Start from
            </label>
            <select
              id={startId}
              data-testid="workspace-start"
              className={`${field} font-sans`}
              value={start}
              disabled={locked}
              onChange={(event) => {
                setStart(event.target.value);
              }}
            >
              <option value={defaultStart}>
                {visibleLabel(defaultLabel(startView, project.name))}
              </option>
              {otherStarts(phase.prepared.branches, startView).map((branch) => (
                <option key={branch.ref} value={branch.ref}>
                  {visibleLabel(branch.label)}
                </option>
              ))}
            </select>
          </div>
        )}
        {phase.kind === "form" ? (
          <p data-testid="workspace-hooks-note" className="text-[12px] text-dim">
            git runs the repository&apos;s own checkout hooks and filters, as it does in your
            terminal.
          </p>
        ) : (
          <StepRows steps={steps} name={name} />
        )}
        {phase.kind === "failed" && (
          <div ref={failure} className="flex flex-col gap-[6px]">
            <p
              role={phase.stopped ? "status" : "alert"}
              data-testid="workspace-failure"
              className={`text-[13px] ${phase.stopped ? "text-fg2" : "text-danger"}`}
            >
              {visibleText(phase.message)}
            </p>
            {failedDetail !== undefined && (
              <pre
                data-testid="workspace-failure-output"
                aria-label="What git said"
                className="max-h-[120px] overflow-y-auto rounded-[8px] bg-side px-[10px] py-2 font-mono text-[12px] break-words whitespace-pre-wrap text-fg2"
              >
                {failedDetail}
              </pre>
            )}
          </div>
        )}
      </>
    );
  };

  const footer = () => {
    if (phase.kind === "unavailable") {
      return (
        <Button variant="ghost" onClick={onClose} testId="close-workspace-dialog">
          Close
        </Button>
      );
    }
    if (phase.kind === "running") {
      return (
        <>
          <span className="mr-auto min-w-0 text-[12px] text-dim">
            Cancel stops git and undoes what was made.
          </span>
          <Button
            key="stop"
            variant="ghost"
            autoFocus
            disabled={phase.stopping}
            onClick={stopCreation}
            testId="cancel-creation"
          >
            Cancel
          </Button>
          <Button onClick={create} disabled testId="create-workspace">
            Creating…
          </Button>
        </>
      );
    }
    if (phase.kind === "failed") {
      return (
        <>
          <Button variant="ghost" onClick={onClose} testId="close-workspace-dialog" autoFocus>
            Close
          </Button>
          <Button
            onClick={() => {
              setPhase({ kind: "form", prepared: phase.prepared });
            }}
            testId="try-again-workspace"
          >
            Try again
          </Button>
        </>
      );
    }
    return (
      <>
        <Button variant="ghost" onClick={onClose} testId="cancel-workspace">
          Cancel
        </Button>
        {phase.kind === "form" && (
          <Button onClick={create} disabled={!canCreate} shortcut="↵" testId="create-workspace">
            Create workspace
          </Button>
        )}
      </>
    );
  };

  return (
    <Dialog
      title="New workspace"
      description={`A fresh worktree and branch in ${projectName}.`}
      testId="new-workspace-dialog"
      onClose={onClose}
      closable={phase.kind !== "running"}
      footer={footer()}
    >
      {body()}
    </Dialog>
  );
}

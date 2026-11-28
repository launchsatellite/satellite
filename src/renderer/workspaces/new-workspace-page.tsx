import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  bridgeLimits,
  firstMessage,
  type BridgeResponse,
  type CreationStep,
  type ProjectView,
  type StartChoice,
  type StartView,
  type WorkspaceView,
} from "../../shared/bridge-contract.ts";
import { visibleText } from "../../shared/visible-text.ts";
import { workspaceNameLimit, workspaceNameProblem } from "../../shared/workspace-name.ts";
import { invoke, subscribe } from "../bridge/bridge-client.ts";
import { keyboardPlatform, matchesShortcut, shortcutLabel } from "../commands/shortcuts.ts";
import { Button } from "../ui/button.tsx";
import { fieldLook, Input } from "../ui/input.tsx";
import { Select } from "../ui/select.tsx";
import { StatusPixel, type PixelState } from "../ui/status-pixel.tsx";
import { visibleLabel } from "../ui/visible-name.tsx";
import { Page } from "../window/page.tsx";
import type { Frame } from "../window/top-row.tsx";

type Prepared = BridgeResponse<"workspaces.prepare">;
type StepState = "pending" | "running" | "done" | "failed" | "undone";
type Phase =
  | { kind: "reading" }
  | { kind: "unavailable"; message: string }
  | { kind: "form"; prepared: Prepared }
  | { kind: "running"; prepared: Prepared; operationId: string; stopping: boolean }
  | { kind: "failed"; prepared: Prepared; message: string; stopped: boolean };
type Steps = Record<CreationStep, { state: StepState; detail: string | null }>;

interface NewWorkspacePageProps {
  projects: readonly ProjectView[];
  first: string;
  onBack: () => void;
  onBusy: (busy: boolean) => void;
  onCreated: (project: ProjectView, workspace: WorkspaceView, request: string | undefined) => void;
  frame: Frame;
  edges: { left: number; right: number };
}

const stepOrder: readonly CreationStep[] = ["start", "branch", "worktree", "files", "save"];
const defaultStart = "default";
const createKeys = { key: "Enter", ctrlAlone: true };
const oneWord =
  "Write a few words for Claude Code, or leave the box empty to start a blank session.";
const undoneSteps: readonly CreationStep[] = ["branch", "worktree", "files"];
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

export function NewWorkspacePage({
  projects,
  first,
  onBack,
  onBusy,
  onCreated,
  frame,
  edges,
}: NewWorkspacePageProps) {
  const requestId = useId();
  const nameId = useId();
  const problemId = useId();
  const failure = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const stopping = useRef(false);
  const unsubscribe = useRef<(() => void) | undefined>(undefined);
  const [projectId, setProjectId] = useState(first);
  const [phase, setPhase] = useState<Phase>({ kind: "reading" });
  const [request, setRequest] = useState("");
  const [name, setName] = useState("");
  const [start, setStart] = useState(defaultStart);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [steps, setSteps] = useState<Steps>(pendingSteps);
  const project = projects.find((listed) => listed.id === projectId) ?? projects[0];
  const projectName = visibleText(project?.name ?? "");
  const platform = keyboardPlatform();

  useEffect(() => {
    let current = true;
    void invoke("workspaces.prepare", { projectId }).then((result) => {
      if (!current) return;
      if (!result.ok) {
        setPhase({ kind: "unavailable", message: result.error.message });
        return;
      }
      setName(result.value.name);
      setPhase({ kind: "form", prepared: result.value });
    });
    return () => {
      current = false;
    };
  }, [projectId]);
  useEffect(
    () => () => {
      unsubscribe.current?.();
      onBusy(false);
    },
    [onBusy],
  );

  const failedDetail =
    stepOrder
      .map((step) => steps[step])
      .find((entry) => entry.state === "failed" && entry.detail !== null)?.detail ?? undefined;
  useLayoutEffect(() => {
    if (phase.kind === "failed") failure.current?.scrollIntoView({ block: "end" });
  }, [phase.kind, failedDetail]);

  const trimmed = request.trim();
  const wordy = trimmed === "" || firstMessage.safeParse(trimmed).success;
  const problem = workspaceNameProblem(name);
  const canCreate =
    phase.kind === "form" && problem === null && wordy && phase.prepared.start.kind !== "empty";

  const create = () => {
    if (!canCreate || submitting.current || project === undefined) return;
    submitting.current = true;
    stopping.current = false;
    const operationId = crypto.randomUUID();
    const chosen = project;
    let reported = false;
    const started = new Set<CreationStep>();
    const undone = new Set<CreationStep>();
    setRefusal(null);
    setSteps(pendingSteps());
    setPhase({ kind: "running", prepared: phase.prepared, operationId, stopping: false });
    onBusy(true);
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
      projectId: chosen.id,
      name,
      start: chosenStart(start),
    }).then((result) => {
      unsubscribe.current?.();
      unsubscribe.current = undefined;
      onBusy(false);
      if (result.ok) {
        onCreated(chosen, result.value.workspace, trimmed === "" ? undefined : trimmed);
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

  const press = (event: KeyboardEvent<HTMLElement>) => {
    if (!matchesShortcut(event.nativeEvent, createKeys, platform)) return;
    event.preventDefault();
    create();
  };

  const locked = phase.kind !== "form";
  const shownProblem = refusal ?? problem;
  const prepared = phase.kind === "reading" || phase.kind === "unavailable" ? null : phase.prepared;
  const startView = prepared?.start;
  const pickers = (
    <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
      <Select
        label="Repo"
        testId="workspace-repo"
        value={projectId}
        disabled={phase.kind === "running"}
        onChange={(chosen) => {
          setRefusal(null);
          setStart(defaultStart);
          setPhase({ kind: "reading" });
          setProjectId(chosen);
        }}
        options={projects.map((listed) => ({
          value: listed.id,
          label: visibleLabel(listed.name),
        }))}
        className="h-7 max-w-[200px]"
      />
      {prepared !== null && startView !== undefined && startView.kind !== "empty" && (
        <Select
          label="Start from"
          testId="workspace-start"
          value={start}
          disabled={locked}
          onChange={setStart}
          className="h-7 max-w-[260px]"
          options={[
            {
              value: defaultStart,
              label: visibleLabel(defaultLabel(startView, project?.name ?? "")),
            },
            ...otherStarts(prepared.branches, startView).map((branch) => ({
              value: branch.ref,
              label: visibleLabel(branch.label),
            })),
          ]}
        />
      )}
      {prepared !== null && (
        <Input
          id={nameId}
          aria-label="Workspace name"
          testId="workspace-name"
          className="h-7 w-[200px] font-mono"
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
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              create();
            }
          }}
        />
      )}
      <span className="flex-1" />
      {phase.kind === "running" ? (
        <Button
          key="stop"
          variant="ghost"
          disabled={phase.stopping}
          onClick={stopCreation}
          testId="cancel-creation"
        >
          Cancel
        </Button>
      ) : phase.kind === "failed" ? (
        <Button
          onClick={() => {
            setPhase({ kind: "form", prepared: phase.prepared });
          }}
          testId="try-again-workspace"
        >
          Try again
        </Button>
      ) : (
        <Button
          onClick={create}
          disabled={!canCreate}
          shortcut={shortcutLabel({ key: "↵", ctrlAlone: true }, platform)}
          testId="create-workspace"
        >
          Create and start
        </Button>
      )}
    </div>
  );

  return (
    <Page
      title="what should claude code do"
      lead={`A fresh worktree and branch in ${projectName}, with its own Claude Code session.`}
      testId="new-workspace-page"
      back="Cancel"
      onBack={() => {
        if (phase.kind !== "running") onBack();
      }}
      frame={frame}
      edges={edges}
      focusFirst="textarea"
      start={
        <span className="truncate text-[13px] font-semibold">
          <span className="text-dim">{projectName} / </span>new workspace
        </span>
      }
    >
      <div
        onKeyDown={press}
        className="flex flex-col overflow-hidden rounded-[10px] border border-ctl bg-side focus-within:border-accent"
      >
        <label htmlFor={requestId} className="sr-only">
          Request for Claude Code
        </label>
        <textarea
          id={requestId}
          data-testid="workspace-request"
          value={request}
          maxLength={bridgeLimits.firstMessageChars}
          disabled={phase.kind === "running"}
          rows={5}
          placeholder="Describe the change, or leave it empty to start a blank session"
          aria-invalid={!wordy}
          onChange={(event) => {
            setRequest(event.target.value);
          }}
          className={`${fieldLook} h-auto min-h-[120px] resize-y rounded-none border-0 bg-transparent py-3 text-[14px] leading-[21px]`}
        />
        {pickers}
      </div>
      <p
        key={refusal ?? "typed"}
        id={problemId}
        data-testid="workspace-name-problem"
        role={refusal === null ? undefined : "alert"}
        className={`text-[12px] ${shownProblem === null && wordy ? "text-dim" : "text-danger"}`}
      >
        {visibleText(
          shownProblem ??
            (wordy
              ? `The branch takes the name too. Claude Code starts in it${trimmed === "" ? "" : " with your words as its first message"}.`
              : oneWord),
        )}
      </p>
      {phase.kind === "reading" && (
        <p className="text-[13px] break-words text-dim">Reading {projectName}…</p>
      )}
      {phase.kind === "unavailable" && (
        <p role="alert" data-testid="workspace-failure" className="text-[13px] text-danger">
          {visibleText(phase.message)}
        </p>
      )}
      {startView?.kind === "empty" && (
        <p data-testid="workspace-start-note" className="text-[13px] text-fg2">
          {projectName} has no commits yet. Make a first commit, then make a workspace.
        </p>
      )}
      {phase.kind === "form" && (
        <p data-testid="workspace-hooks-note" className="text-[12px] text-dim">
          git runs the repository&apos;s own checkout hooks and filters, as it does in your
          terminal.
        </p>
      )}
      {(phase.kind === "running" || phase.kind === "failed") && (
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
    </Page>
  );
}

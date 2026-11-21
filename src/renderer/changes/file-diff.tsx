import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import type {
  ChangedFile,
  ChangeLetter,
  ChangesView,
  FileSides,
  WorkspaceRef,
} from "../../shared/bridge-contract.ts";
import { invoke } from "../bridge/bridge-client.ts";
import type { DiffHandle, DiffSide } from "../diff/read-only-editor.tsx";
import { diffLabels, sideSentence } from "./change-words.ts";
import { changesPlace, pollDelay } from "./use-changes.ts";

export interface ShownText {
  path: string;
  from: string | null;
  letter: ChangeLetter;
  view: ChangesView;
  base: string | null;
}

interface FileDiffProps {
  workspace: WorkspaceRef;
  view: ChangesView;
  file: ChangedFile;
  base: string | null;
  inline: boolean;
  handle: Ref<DiffHandle>;
  onShown: (shown: ShownText | null) => void;
}

interface Answer {
  key: string;
  file: ChangedFile;
  sides: FileSides | null;
  failure: string | null;
}

const editors = () =>
  Promise.all([import("../diff/diff-view.tsx"), import("../diff/side-view.tsx")]);
const DiffView = lazy(() => editors().then(([module]) => ({ default: module.DiffView })));
const SideView = lazy(() => editors().then(([, module]) => ({ default: module.SideView })));
const cachedAnswers = 8;
const editorFailedSentence =
  "Satellite couldn't load the diff viewer, so there is no diff to show.";
const cachedChars = 8_388_608;
const answers = new Map<string, { sides: FileSides; chars: number }>();

function passing(answer: Answer): boolean {
  return answer.sides === null || answer.sides.kind === "changing" || answer.sides.kind === "hung";
}

function sidesChars(sides: FileSides): number {
  return sides.kind === "text" ? sides.original.length + sides.modified.length : 0;
}

function remember(key: string, sides: FileSides): void {
  answers.delete(key);
  answers.set(key, { sides, chars: sidesChars(sides) });
  let total = [...answers.values()].reduce((sum, kept) => sum + kept.chars, 0);
  for (const [oldest, kept] of answers) {
    if (answers.size <= 1 || (answers.size <= cachedAnswers && total <= cachedChars)) break;
    answers.delete(oldest);
    total -= kept.chars;
  }
}

function recalled(key: string): FileSides | undefined {
  const kept = answers.get(key);
  if (kept === undefined) return undefined;
  answers.delete(key);
  answers.set(key, kept);
  return kept.sides;
}

function peeked(key: string): FileSides | undefined {
  return answers.get(key)?.sides;
}

class EditorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p
          data-testid="changes-sentence"
          className="max-w-[360px] text-center text-[13px] text-fg2"
        >
          {editorFailedSentence}
        </p>
      </div>
    );
  }
}

function Opening() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <p data-testid="diff-loading" className="text-[13px] text-dim">
        Opening the diff…
      </p>
    </div>
  );
}

function Editors({
  sides,
  file,
  inline,
  handle,
}: {
  sides: Extract<FileSides, { kind: "text" }>;
  file: ChangedFile;
  inline: boolean;
  handle: Ref<DiffHandle>;
}) {
  const labels = diffLabels(file);
  const only = sideOnly(file.letter);
  if (only === null) {
    return (
      <DiffView
        original={sides.original}
        modified={sides.modified}
        path={file.path}
        inline={inline}
        labels={labels}
        handle={handle}
      />
    );
  }
  return (
    <SideView
      text={only === "original" ? sides.original : sides.modified}
      side={only}
      path={file.path}
      label={labels[only]}
      handle={handle}
    />
  );
}

export function sideOnly(letter: ChangeLetter): DiffSide | null {
  if (letter === "A") return "modified";
  if (letter === "D") return "original";
  return null;
}

export function FileDiff({ workspace, view, file, base, inline, handle, onShown }: FileDiffProps) {
  const place = changesPlace(workspace, view);
  const key = `${place}\u0000${file.path}\u0000${file.stamp}`;
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [retried, setRetried] = useState({ key, count: 0 });
  const attempt = retried.key === key ? retried.count : 0;
  const sequence = useRef(0);
  const listedFile = useRef(file);
  const { projectId, workspace: workspaceKey } = workspace;
  const { path } = file;

  useEffect(() => {
    listedFile.current = file;
  }, [file]);

  useEffect(() => {
    sequence.current += 1;
    const asked = sequence.current;
    const listed = listedFile.current;
    const cached = recalled(key);
    if (cached !== undefined) {
      setAnswer({ key, file: listed, sides: cached, failure: null });
      return;
    }
    void invoke("changes.file", {
      workspace: { projectId, workspace: workspaceKey },
      view,
      path,
    }).then((result) => {
      if (asked !== sequence.current) return;
      const answered: Answer = result.ok
        ? { key, file: listed, sides: result.value, failure: null }
        : { key, file: listed, sides: null, failure: result.error.message };
      if (result.ok && !passing(answered)) remember(key, result.value);
      setAnswer(answered);
    });
  }, [key, projectId, workspaceKey, view, path, attempt]);

  useEffect(() => {
    if (answer?.key !== key || !passing(answer)) return;
    const again = () => {
      setRetried({ key, count: attempt + 1 });
    };
    const whenVisible = () => {
      if (document.visibilityState === "visible") again();
    };
    const timer = setTimeout(
      () => {
        if (document.visibilityState === "visible") again();
        else document.addEventListener("visibilitychange", whenVisible);
      },
      pollDelay(0, attempt),
    );
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", whenVisible);
    };
  }, [answer, key, attempt]);

  useEffect(
    () => () => {
      sequence.current += 1;
    },
    [],
  );

  const ready = answer?.key === key ? undefined : peeked(key);
  const drawn: Answer | null =
    ready === undefined ? answer : { key, file, sides: ready, failure: null };
  const shown = drawn?.sides?.kind === "text" ? drawn.file : null;
  useEffect(() => {
    onShown(
      shown === null
        ? null
        : { path: shown.path, from: shown.from, letter: shown.letter, view, base },
    );
  }, [shown, view, base, onShown]);
  useEffect(
    () => () => {
      onShown(null);
    },
    [onShown],
  );

  if (drawn === null) return <Opening />;
  const stale = drawn.file.path !== path;
  return (
    <div className={`h-full ${stale ? "opacity-50" : ""}`} aria-busy={stale || undefined}>
      {drawn.sides?.kind === "text" ? (
        <EditorBoundary>
          <Suspense fallback={<Opening />}>
            <Editors sides={drawn.sides} file={drawn.file} inline={inline} handle={handle} />
          </Suspense>
        </EditorBoundary>
      ) : (
        <div className="flex h-full items-center justify-center p-8">
          <p
            data-testid="changes-sentence"
            className="max-w-[360px] text-center text-[13px] text-fg2"
          >
            {drawn.sides === null ? drawn.failure : sideSentence(drawn.sides)}
          </p>
        </div>
      )}
    </div>
  );
}

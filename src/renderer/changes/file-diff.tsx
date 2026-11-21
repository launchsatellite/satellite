import { lazy, Suspense, useEffect, useRef, useState, type Ref } from "react";
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
import { changesPlace } from "./use-changes.ts";

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
const cachedChars = 8_388_608;
const answers = new Map<string, { sides: FileSides; chars: number }>();

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

export function sideOnly(letter: ChangeLetter): DiffSide | null {
  if (letter === "A") return "modified";
  if (letter === "D") return "original";
  return null;
}

export function FileDiff({ workspace, view, file, base, inline, handle, onShown }: FileDiffProps) {
  const place = changesPlace(workspace, view);
  const key = `${place}\u0000${file.path}\u0000${file.stamp}`;
  const [answer, setAnswer] = useState<Answer | null>(null);
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
      if (result.ok) remember(key, result.value);
      setAnswer(
        result.ok
          ? { key, file: listed, sides: result.value, failure: null }
          : { key, file: listed, sides: null, failure: result.error.message },
      );
    });
  }, [key, projectId, workspaceKey, view, path]);

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

  if (drawn === null) return <div className="h-full" />;
  if (drawn.sides?.kind === "text") {
    const { original, modified } = drawn.sides;
    const labels = diffLabels(drawn.file);
    const only = sideOnly(drawn.file.letter);
    return (
      <Suspense fallback={<div className="h-full" />}>
        {only === null ? (
          <DiffView
            original={original}
            modified={modified}
            path={drawn.file.path}
            inline={inline}
            labels={labels}
            handle={handle}
          />
        ) : (
          <SideView
            text={only === "original" ? original : modified}
            side={only}
            path={drawn.file.path}
            label={labels[only]}
            handle={handle}
          />
        )}
      </Suspense>
    );
  }
  return (
    <div className="flex h-full items-center justify-center p-8">
      <p data-testid="changes-sentence" className="max-w-[360px] text-center text-[13px] text-fg2">
        {drawn.sides === null ? drawn.failure : sideSentence(drawn.sides)}
      </p>
    </div>
  );
}

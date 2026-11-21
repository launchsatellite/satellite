import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { FileRead, WorkspaceRef } from "../../shared/bridge-contract.ts";
import { visibleText } from "../../shared/visible-text.ts";
import { invoke } from "../bridge/bridge-client.ts";
import { EditorBoundary } from "../changes/file-diff.tsx";
import {
  fileSentence,
  linkNoteSentence,
  openingFileSentence,
  pickFileSentence,
  viewerFailedSentence,
} from "./file-words.ts";

interface FilePaneProps {
  workspace: WorkspaceRef;
  path: string | undefined;
}

type ShownRead = Exclude<FileRead, { kind: "same" }>;
type KeptRead = Extract<FileRead, { kind: "text" | "link" }>;

interface Answer {
  key: string;
  read: ShownRead | null;
  failure: string | null;
}

const SideView = lazy(() =>
  import("../diff/side-view.tsx").then((module) => ({ default: module.SideView })),
);
const cachedReads = 8;
const cachedChars = 8_388_608;
const reads = new Map<string, KeptRead>();

function remember(key: string, read: KeptRead): void {
  reads.delete(key);
  reads.set(key, read);
  let total = [...reads.values()].reduce((sum, kept) => sum + kept.text.length, 0);
  for (const [oldest, kept] of reads) {
    if (reads.size <= 1 || (reads.size <= cachedReads && total <= cachedChars)) break;
    reads.delete(oldest);
    total -= kept.text.length;
  }
}

function Sentence({ testId, text }: { testId: string; text: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <p data-testid={testId} className="max-w-[360px] text-center text-[13px] text-fg2">
        {text}
      </p>
    </div>
  );
}

function Opening() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <p data-testid="file-loading" className="text-[13px] text-dim">
        {openingFileSentence}
      </p>
    </div>
  );
}

function Viewer({ read, path }: { read: KeptRead; path: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {read.kind === "link" && (
        <p
          data-testid="file-link-note"
          className="flex-none border-b border-line px-3 py-2 text-[12px] text-fg2"
        >
          {linkNoteSentence}
        </p>
      )}
      <div className="min-h-0 flex-1">
        <EditorBoundary sentence={viewerFailedSentence} testId="file-sentence">
          <Suspense fallback={<Opening />}>
            <SideView text={read.text} side={null} path={path} label={visibleText(path)} />
          </Suspense>
        </EditorBoundary>
      </div>
    </div>
  );
}

function Drawn({ answer, path }: { answer: Answer; path: string }) {
  const { read } = answer;
  if (read === null) return <Sentence testId="file-sentence" text={answer.failure ?? ""} />;
  if (read.kind === "text" || read.kind === "link") return <Viewer read={read} path={path} />;
  const sentence = fileSentence(read);
  return sentence === undefined ? null : <Sentence testId="file-sentence" text={sentence} />;
}

export function FilePane({ workspace, path }: FilePaneProps) {
  const { projectId, workspace: workspaceKey } = workspace;
  const key = path === undefined ? "" : `${projectId}/${workspaceKey}\u0000${path}`;
  const [answer, setAnswer] = useState<Answer | null>(null);
  const sequence = useRef(0);

  useEffect(() => {
    sequence.current += 1;
    if (path === undefined) return;
    const asked = sequence.current;
    const kept = reads.get(key);
    if (kept !== undefined) {
      reads.delete(key);
      reads.set(key, kept);
    }
    void invoke("files.read", {
      workspace: { projectId, workspace: workspaceKey },
      path,
      known: kept?.stamp ?? null,
    }).then((result) => {
      if (asked !== sequence.current) return;
      if (!result.ok) {
        setAnswer({ key, read: null, failure: result.error.message });
        return;
      }
      const read = result.value;
      if (read.kind === "same") return;
      if (read.kind === "text" || read.kind === "link") remember(key, read);
      else reads.delete(key);
      setAnswer({ key, read, failure: null });
    });
  }, [key, projectId, workspaceKey, path]);

  useEffect(
    () => () => {
      sequence.current += 1;
    },
    [],
  );

  const body = () => {
    if (path === undefined) return <Sentence testId="file-empty" text={pickFileSentence} />;
    const kept = reads.get(key);
    if (answer?.key === key) return <Drawn answer={answer} path={path} />;
    return kept === undefined ? <Opening /> : <Viewer read={kept} path={path} />;
  };
  return (
    <div data-testid="file-pane" className="h-full min-h-0">
      {body()}
    </div>
  );
}

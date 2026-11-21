import { lazy, Suspense } from "react";
import type { FileRead } from "../../shared/bridge-contract.ts";
import { visibleText } from "../../shared/visible-text.ts";
import { EditorBoundary } from "../changes/file-diff.tsx";
import {
  fileSentence,
  linkNoteSentence,
  openingFileSentence,
  pickFileSentence,
  viewerFailedSentence,
} from "./file-words.ts";
import type { FileShown } from "./use-files.ts";

interface FilePaneProps {
  file: FileShown | undefined;
  path: string | undefined;
}

type KeptRead = Extract<FileRead, { kind: "text" | "link" }>;

const SideView = lazy(() =>
  import("../diff/side-view.tsx").then((module) => ({ default: module.SideView })),
);

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

function Drawn({ read, path }: { read: FileShown["read"]; path: string }) {
  if (read.kind === "text" || read.kind === "link") return <Viewer read={read} path={path} />;
  const sentence = fileSentence(read);
  return sentence === undefined ? null : <Sentence testId="file-sentence" text={sentence} />;
}

export function FilePane({ file, path }: FilePaneProps) {
  if (path === undefined) {
    return (
      <div data-testid="file-pane" className="h-full min-h-0">
        <Sentence testId="file-empty" text={pickFileSentence} />
      </div>
    );
  }
  return (
    <div data-testid="file-pane" className="h-full min-h-0">
      {file === undefined ? <Opening /> : <Drawn read={file.read} path={path} />}
    </div>
  );
}

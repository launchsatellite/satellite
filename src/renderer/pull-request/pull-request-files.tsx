import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ChangesList, PullRequestFound, WorkspaceRef } from "../../shared/bridge-contract.ts";
import { ChangeList } from "../changes/change-list.tsx";
import { emptySentence, unavailableSentence } from "../changes/change-words.ts";
import { FileDiff, type ShownText } from "../changes/file-diff.tsx";
import type { DiffHandle } from "../diff/read-only-editor.tsx";
import { sendToClaudeCode } from "../sessions/send-to-claude-code.ts";
import { Button } from "../ui/button.tsx";
import { VisibleName } from "../ui/visible-name.tsx";
import { Sentence } from "./pull-request-sentence.tsx";
import { baseRequest } from "./pull-request-requests.ts";
import {
  loadingSentence,
  noBaseSentence,
  notAtHeadSentence,
  sendLabel,
} from "./pull-request-words.ts";
import { ThreadPanel } from "./thread-panel.tsx";
import { threadPlaces } from "./thread-places.ts";

export interface ThreadTarget {
  index: number;
  seq: number;
}

interface PullRequestFilesProps {
  workspace: WorkspaceRef;
  found: PullRequestFound;
  list: ChangesList | undefined;
  error: string | null;
  handle: RefObject<DiffHandle | null>;
  current: ThreadTarget | null;
  onCurrent: (index: number) => void;
  onLink: (address: string) => void;
}

const revealFrames = 90;

export function PullRequestFiles({
  workspace,
  found,
  list,
  error,
  handle,
  current,
  onCurrent,
  onLink,
}: PullRequestFilesProps) {
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const [handled, setHandled] = useState(0);
  const [shown, setShown] = useState<ShownText | null>(null);
  const revealed = useRef(0);
  const changes = list?.changes;
  const files = useMemo(() => (changes?.kind === "files" ? changes.files : []), [changes]);
  const detail = found.detail?.kind === "read" ? found.detail : null;
  const target = current === null ? undefined : detail?.threads[current.index];
  if (current !== null && current.seq !== handled && list !== undefined) {
    setHandled(current.seq);
    const path = target?.path;
    if (path !== null && path !== undefined && files.some((listed) => listed.path === path)) {
      setPickedPath(path);
    }
  }
  const file = files.find((listed) => listed.path === pickedPath) ?? files[0];
  const places = useMemo(
    () => (detail === null || file === undefined ? null : threadPlaces(detail, file.path)),
    [detail, file],
  );
  const marks = useMemo(
    () => (places?.marks ?? []).map(({ line, unresolved }) => ({ line, unresolved })),
    [places],
  );
  const onMark = useCallback(
    (line: number) => {
      const index = places?.marks.find((mark) => mark.line === line)?.threads[0];
      if (index !== undefined) onCurrent(index);
    },
    [places, onCurrent],
  );
  const onShown = useCallback((next: ShownText | null) => {
    setShown((kept) =>
      kept?.path === next?.path && kept?.letter === next?.letter && kept?.base === next?.base
        ? kept
        : next,
    );
  }, []);
  const revealAt =
    shown !== null && target?.path === shown.path && target.line !== null ? target.line : null;
  const seq = current?.seq ?? 0;
  const markedAt = revealAt !== null && marks.some((mark) => mark.line === revealAt);

  useEffect(() => {
    if (seq === 0 || revealed.current === seq || revealAt === null || !markedAt) return;
    let frame = 0;
    let id = 0;
    const attempt = () => {
      if (handle.current?.reveal(revealAt) === true) {
        revealed.current = seq;
        return;
      }
      frame += 1;
      if (frame < revealFrames) id = requestAnimationFrame(attempt);
    };
    id = requestAnimationFrame(attempt);
    return () => {
      cancelAnimationFrame(id);
    };
  }, [seq, revealAt, markedAt, handle]);

  const select = (path: string) => {
    setPickedPath(path);
  };

  const body = () => {
    if (list === undefined || changes === undefined) {
      return error === null ? (
        <Sentence testId="pull-request-files-loading" text={loadingSentence} />
      ) : (
        <Sentence testId="pull-request-files-error" text={error} />
      );
    }
    if (changes.kind === "unavailable") {
      const missing = changes.reason === "no-base" || changes.reason === "not-local";
      const text =
        changes.reason === "no-base"
          ? noBaseSentence(found.base)
          : unavailableSentence(changes.reason, list.base);
      return (
        <Sentence testId="pull-request-files-unavailable" text={text}>
          {missing && (
            <Button
              variant="secondary"
              size="small"
              testId="pull-request-base-send"
              onClick={() => {
                sendToClaudeCode(baseRequest(found.base));
              }}
            >
              {sendLabel}
            </Button>
          )}
        </Sentence>
      );
    }
    if (files.length === 0 && changes.more === 0 && changes.longPaths === 0) {
      return (
        <Sentence
          testId="pull-request-files-empty"
          text={emptySentence("branch", list.base ?? found.base)}
        />
      );
    }
    return (
      <div className="@container flex h-full min-h-0">
        <div className="flex h-full min-h-0 w-full flex-col @min-[640px]:flex-row">
          <div className="flex max-h-[30%] min-h-0 flex-none flex-col border-b border-line @min-[640px]:max-h-none @min-[640px]:w-[240px] @min-[640px]:border-r @min-[640px]:border-b-0">
            <ChangeList
              files={files}
              more={changes.more}
              longPaths={changes.longPaths}
              selected={file?.path}
              onSelect={select}
            />
            {error !== null && (
              <p data-testid="pull-request-files-error" className="px-3 py-2 text-[12px] text-fg2">
                {error}
              </p>
            )}
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              {file !== undefined && (
                <FileDiff
                  workspace={workspace}
                  view="branch"
                  file={file}
                  base={list.base}
                  named={found.base ?? undefined}
                  inline
                  handle={handle}
                  onShown={onShown}
                  marks={marks}
                  onMark={onMark}
                />
              )}
            </div>
            {detail !== null && places !== null && (
              <ThreadPanel
                found={found}
                threads={detail.threads}
                marks={places.marks}
                listed={places.listed}
                current={current?.index ?? null}
                onSelect={onCurrent}
                onLink={onLink}
              />
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div data-testid="pull-request-files" className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none flex-col gap-1 border-b border-line px-4 py-2 text-[12px] text-dim">
        <p data-testid="pull-request-files-note" dir="ltr" className="[unicode-bidi:isolate]">
          These are the files in this workspace against{" "}
          <span className="font-mono text-fg2">
            <VisibleName text={list?.base ?? found.base ?? "the base branch"} />
          </span>
          .
        </p>
        {found.atHead === false && <p>{notAtHeadSentence}</p>}
      </div>
      <div className="min-h-0 flex-1">{body()}</div>
    </div>
  );
}

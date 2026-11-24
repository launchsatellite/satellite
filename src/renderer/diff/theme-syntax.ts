import { editor, languages, type IDisposable } from "monaco-editor/editor/editor.api";
import { changesLimits } from "../../shared/bridge-contract.ts";
import type { EditorTheme } from "../../shared/themes/theme-look.ts";
import { shownLook } from "../ui/shown-theme.ts";
import { monarchModule } from "./diff-language.ts";
import { silenceWatch } from "./silence-watch.ts";
import type { SyntaxBatch, SyntaxRequest } from "./syntax-worker.ts";
import SyntaxWorker from "./syntax-worker.ts?worker";
import { monacoTheme } from "./theme-rules.ts";

interface Sent {
  request: number;
  keys: number[];
  done: boolean;
}

const curatedThemeName = "satellite-curated";
const refreshEveryMs = 150;
const redrawAfterMs = 300;
const silentWorkerMs = 5000;
const colouredLines = changesLimits.sideLines;
const largestCache = 2 * colouredLines;
const plainLine: languages.IToken[] = [{ startIndex: 0, scopes: "" }];
const lent = new Map<string, IDisposable>();
const sent = new Map<editor.ITextModel, Sent>();
const byRequest = new Map<number, editor.ITextModel>();
const cache = new Map<number, languages.IToken[]>();
const refreshing = new Set<string>();
const redrawing = new Set<editor.ITextModel>();
const tracked = new WeakSet<editor.ITextModel>();

let shownTheme: EditorTheme | undefined;
let watching = false;
let worker: Worker | undefined;
const watch = silenceWatch(silentWorkerMs, replaceWorker);
let nextRequest = 0;

class KeyState implements languages.IState {
  readonly key: number;

  constructor(key: number) {
    this.key = key;
  }

  clone(): this {
    return this;
  }

  equals(other: languages.IState): boolean {
    return other instanceof KeyState && other.key === this.key;
  }
}

function lineKey(line: string, previous: number): number {
  let first = 0xdeadbeef ^ (previous >>> 0);
  let second = 0x41c6ce57 ^ Math.floor(previous / 0x100000000);
  for (let at = 0; at < line.length; at++) {
    const code = line.charCodeAt(at);
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }
  first =
    Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
  second =
    Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
  return 4294967296 * (2097151 & second) + (first >>> 0);
}

function startKey(language: string): number {
  return lineKey(language, 0);
}

function keyedTokens(language: string): languages.TokensProvider {
  return {
    getInitialState: () => new KeyState(startKey(language)),
    tokenize(line, state) {
      const previous = state instanceof KeyState ? state.key : startKey(language);
      const key = lineKey(line, previous);
      return { tokens: cache.get(key) ?? plainLine, endState: new KeyState(key) };
    },
  };
}

function redrawRemovedLines(model: editor.ITextModel): void {
  if (redrawing.has(model)) return;
  redrawing.add(model);
  setTimeout(() => {
    redrawing.delete(model);
    if (model.isDisposed()) return;
    for (const diff of editor.getDiffEditors()) {
      if (diff.getModel()?.original !== model) continue;
      diff.getOriginalEditor().changeViewZones((zones) => {
        zones.removeZone(
          zones.addZone({
            afterLineNumber: 0,
            heightInPx: 0,
            domNode: document.createElement("div"),
          }),
        );
      });
    }
  }, redrawAfterMs);
}

function redrawLanguage(language: string): void {
  for (const model of editor.getModels()) {
    if (model.getLanguageId() === language) redrawRemovedLines(model);
  }
}

function lend(language: string): void {
  const before = lent.get(language);
  languages.registerTokensProviderFactory(language, { create: () => null });
  lent.set(language, languages.setTokensProvider(language, keyedTokens(language)));
  before?.dispose();
}

function refresh(language: string): void {
  if (refreshing.has(language)) return;
  refreshing.add(language);
  setTimeout(() => {
    refreshing.delete(language);
    if (!lent.has(language)) return;
    lend(language);
    redrawLanguage(language);
  }, refreshEveryMs);
}

function release(keys: number[]): void {
  const kept = new Set<number>();
  for (const other of sent.values()) for (const key of other.keys) kept.add(key);
  for (const key of keys) if (!kept.has(key)) cache.delete(key);
}

function forget(model: editor.ITextModel): void {
  const before = sent.get(model);
  if (before === undefined) return;
  sent.delete(model);
  byRequest.delete(before.request);
  release(before.keys);
  if (!before.done) worker?.postMessage({ kind: "cancel", request: before.request });
}

function waiting(): boolean {
  return [...sent.values()].some((record) => !record.done);
}

function replaceWorker(): void {
  worker?.terminate();
  worker = undefined;
  watch.stop();
  for (const record of sent.values()) record.done = true;
}

function received({ data }: MessageEvent<SyntaxBatch>): void {
  const model = byRequest.get(data.request);
  const record = model === undefined ? undefined : sent.get(model);
  if (model !== undefined && record !== undefined) {
    if (cache.size > largestCache) cache.clear();
    data.tokens.forEach((tokens, offset) => {
      const key = record.keys[data.from + offset];
      if (tokens === null || key === undefined) return;
      cache.set(
        key,
        tokens.map(([startIndex, scopes]) => ({ startIndex, scopes })),
      );
    });
    if (data.done) record.done = true;
    if (data.tokens.some((tokens) => tokens !== null)) refresh(model.getLanguageId());
  }
  watch.heard(waiting());
}

function post(message: SyntaxRequest): void {
  if (worker === undefined) {
    worker = new SyntaxWorker();
    worker.addEventListener("message", received);
    worker.addEventListener("error", replaceWorker);
  }
  worker.postMessage(message);
  watch.sent();
}

function send(theme: EditorTheme, model: editor.ITextModel): void {
  if (model.isDisposed() || model.getLineCount() > colouredLines) return;
  const language = model.getLanguageId();
  const lines = model.getLinesContent();
  const keys: number[] = [];
  let key = startKey(language);
  for (const line of lines) {
    key = lineKey(line, key);
    keys.push(key);
  }
  const before = sent.get(model);
  if (before !== undefined && !before.done)
    worker?.postMessage({ kind: "cancel", request: before.request });
  if (before !== undefined) byRequest.delete(before.request);
  const request = ++nextRequest;
  sent.set(model, { request, keys, done: false });
  byRequest.set(request, model);
  if (before !== undefined) release(before.keys);
  post({ kind: "tokenize", request, theme, language, lines });
}

function colour(theme: EditorTheme, model: editor.ITextModel): void {
  const language = model.getLanguageId();
  if (language === "plaintext") return;
  if (!lent.has(language)) lend(language);
  send(theme, model);
}

async function giveBack(language: string): Promise<void> {
  const given = lent.get(language);
  lent.delete(language);
  given?.dispose();
  const loaded = await monarchModule(language);
  if (lent.has(language) || loaded === undefined) return;
  languages.setMonarchTokensProvider(language, loaded.language);
  redrawLanguage(language);
}

function track(model: editor.ITextModel): void {
  if (tracked.has(model)) return;
  tracked.add(model);
  model.onDidChangeContent(() => {
    if (shownTheme !== undefined && sent.has(model)) send(shownTheme, model);
  });
  model.onWillDispose(() => {
    forget(model);
  });
}

function watchModels(): void {
  if (watching) return;
  watching = true;
  for (const model of editor.getModels()) track(model);
  editor.onDidCreateModel((model) => {
    track(model);
    if (shownTheme === undefined) redrawRemovedLines(model);
    else colour(shownTheme, model);
  });
}

export function showThemeSyntax(): boolean {
  watchModels();
  const theme = shownLook()?.editor;
  if (theme === shownTheme) return theme !== undefined;
  shownTheme = theme;
  for (const model of [...sent.keys()]) forget(model);
  cache.clear();
  if (theme === undefined) {
    for (const language of [...lent.keys()]) void giveBack(language);
    return false;
  }
  editor.defineTheme(curatedThemeName, monacoTheme(theme));
  editor.setTheme(curatedThemeName);
  for (const model of editor.getModels()) colour(theme, model);
  return true;
}

import type { HighlighterCore } from "shiki/core";
import type { EditorTheme } from "../../shared/themes/theme-look.ts";
import { fileTokenizer, tokenBounds, warmUp, type LineTokens } from "./bounded-tokens.ts";
import { grammars } from "./syntax-grammars.ts";
import { scopeOfStyle } from "./theme-rules.ts";

export type SyntaxRequest =
  | { kind: "tokenize"; request: number; theme: EditorTheme; language: string; lines: string[] }
  | { kind: "cancel"; request: number };

export interface SyntaxBatch {
  request: number;
  from: number;
  tokens: LineTokens[];
  done: boolean;
}

interface Job {
  request: number;
  theme: EditorTheme;
  language: string;
  lines: string[];
}

const highlighters = new Map<string, Promise<HighlighterCore>>();
const warmed = new WeakMap<HighlighterCore, Set<string>>();
const queue: Job[] = [];
const cancelled = new Set<number>();

let running: number | undefined;

function highlighterFor(theme: EditorTheme): Promise<HighlighterCore> {
  const key = JSON.stringify(theme);
  let made = highlighters.get(key);
  if (made === undefined) {
    made = Promise.all([import("shiki/core"), import("shiki/engine/javascript")]).then(
      ([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
        createHighlighterCore({
          themes: [structuredClone(theme)],
          langs: [],
          engine: createJavaScriptRegexEngine(),
        }),
    );
    highlighters.set(key, made);
  }
  return made;
}

function post(batch: SyntaxBatch): void {
  self.postMessage(batch);
}

function yieldToMessages(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function tokenize({ request, theme, language, lines }: Job): Promise<void> {
  const grammar = grammars[language];
  if (grammar === undefined) {
    post({ request, from: 0, tokens: [], done: true });
    return;
  }
  const [highlighter, { default: registrations }] = await Promise.all([
    highlighterFor(theme),
    grammar.load(),
  ]);
  const name = registrations.at(-1)?.name;
  if (name === undefined) return;
  await highlighter.loadLanguage(...registrations);
  const { colorMap } = highlighter.setTheme(theme.name);
  const loaded = highlighter.getLanguage(name);
  const names = warmed.get(highlighter) ?? new Set<string>();
  warmed.set(highlighter, names);
  if (!names.has(name)) {
    warmUp(loaded);
    names.add(name);
  }
  const next = fileTokenizer(loaded, colorMap, scopeOfStyle(theme), grammar.longestLine);
  let from = 0;
  let batch: LineTokens[] = [];
  let sliceStarted = performance.now();
  for (const line of lines) {
    batch.push(next(line));
    if (performance.now() - sliceStarted < tokenBounds.sliceMs) continue;
    post({ request, from, tokens: batch, done: false });
    from += batch.length;
    batch = [];
    await yieldToMessages();
    if (cancelled.has(request)) return;
    sliceStarted = performance.now();
  }
  post({ request, from, tokens: batch, done: true });
}

async function drain(): Promise<void> {
  if (running !== undefined) return;
  for (let job = queue.pop(); job !== undefined; job = queue.pop()) {
    if (cancelled.delete(job.request)) continue;
    running = job.request;
    await tokenize(job).catch((error: unknown) => {
      console.error(`Satellite could not colour ${job.language}`, error);
    });
    cancelled.delete(job.request);
  }
  running = undefined;
}

self.addEventListener("message", (event: MessageEvent<SyntaxRequest>) => {
  const message = event.data;
  if (message.kind === "cancel") {
    const { request } = message;
    if (running === request || queue.some((job) => job.request === request)) cancelled.add(request);
    return;
  }
  queue.push(message);
  void drain();
});

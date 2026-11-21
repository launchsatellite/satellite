import { useEffect, useId, useSyncExternalStore } from "react";
import { MarkdownBody } from "./markdown-elements.tsx";
import { createMarkdownParser } from "./markdown-parser.ts";
import MarkdownWorker from "./markdown-worker.ts?worker";

interface MarkdownTextProps {
  text: string;
  onLink: (address: string) => void;
}

const deadlineMs = 500;

const parser = createMarkdownParser((handlers) => {
  const worker = new MarkdownWorker();
  worker.onmessage = (event: MessageEvent<Parameters<typeof handlers.reply>[0]>) => {
    handlers.reply(event.data);
  };
  worker.onerror = () => {
    handlers.fail();
  };
  return {
    post: (text) => {
      worker.postMessage(text);
    },
    stop: () => {
      worker.terminate();
    },
  };
}, deadlineMs);

export function MarkdownText({ text, onLink }: MarkdownTextProps) {
  const owner = useId();
  useEffect(() => {
    parser.want(owner, text);
    return () => {
      parser.drop(owner);
    };
  }, [owner, text]);
  const parsed = useSyncExternalStore(parser.subscribe, () => parser.read(text));
  return (
    <MarkdownBody
      text={text}
      tree={parsed?.kind === "tree" ? parsed.tree : null}
      why={parsed?.kind === "plain" ? parsed.why : undefined}
      waiting={parsed === undefined}
      onLink={onLink}
    />
  );
}

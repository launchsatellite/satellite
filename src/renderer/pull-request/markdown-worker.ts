import { parseMarkdown } from "./markdown-tree.ts";

self.onmessage = (event: MessageEvent<string>) => {
  self.postMessage(parseMarkdown(event.data));
};

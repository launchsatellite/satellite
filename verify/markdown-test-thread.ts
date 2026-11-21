import { parentPort } from "node:worker_threads";
import { parseMarkdown } from "../src/renderer/pull-request/markdown-tree.ts";

parentPort?.on("message", (text: string) => {
  parentPort?.postMessage(parseMarkdown(text));
});

import type { Nodes as HastNodes, Root } from "hast";
import type { Nodes, Root as MarkdownRoot } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { revealLines } from "../../shared/visible-text.ts";

export const longestDrawn = 20_000;
const mostNodes = 20_000;
const deepestTree = 64;

const flowParents = new Set(["root", "blockquote", "listItem", "footnoteDefinition"]);

function reveal(node: Nodes, parent: Nodes | null = null): void {
  if ("value" in node) node.value = revealLines(node.value).text;
  if (node.type === "html") {
    Object.assign(node, {
      type: parent !== null && flowParents.has(parent.type) ? "code" : "inlineCode",
    });
  }
  if (node.type === "image" || node.type === "imageReference") {
    node.alt = revealLines(node.alt ?? "").text;
  }
  if ("children" in node) {
    for (const child of node.children) reveal(child, node);
  }
}

function revealAfterParse() {
  return (tree: MarkdownRoot) => {
    reveal(tree);
  };
}

const processor = unified().use(remarkParse).use(remarkGfm).use(revealAfterParse).use(remarkRehype);

export function boundedTree(root: Root): boolean {
  const waiting: { node: HastNodes; depth: number }[] = [{ node: root, depth: 1 }];
  let seen = 0;
  for (let next = waiting.pop(); next !== undefined; next = waiting.pop()) {
    seen += 1;
    if (seen > mostNodes || next.depth > deepestTree) return false;
    delete next.node.position;
    if ("children" in next.node) {
      for (const child of next.node.children) waiting.push({ node: child, depth: next.depth + 1 });
    }
  }
  return true;
}

export function parseMarkdown(text: string): Root | null {
  if (text.length > longestDrawn) return null;
  try {
    const tree = processor.runSync(processor.parse(text));
    return boundedTree(tree) ? tree : null;
  } catch {
    return null;
  }
}

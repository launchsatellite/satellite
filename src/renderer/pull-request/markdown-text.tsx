import type { Nodes, Root } from "mdast";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { revealLines, visibleText } from "../../shared/visible-text.ts";

interface MarkdownTextProps {
  text: string;
  onLink: (address: string) => void;
}

const InsideLink = createContext(false);
const deepestNesting = 24;
const longestDrawn = 20_000;
const emphasisBudget = 1200;
const bracketBudget = 1500;
const ruleBudget = 200;
const ruleLine = /^[ \t]*[=-]+[ \t]*$/;
const emphasisCharacter = /[*_~]/g;
const bracketCharacter = /[[\]]/g;
const nestingPrefix = /^(?:[ \t]*(?:>|(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$)))*[ \t]*/;

const linkLook =
  "inline cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit] text-fg underline decoration-dim underline-offset-2 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const headingLook: Record<string, string> = {
  h1: "mt-4 mb-2 text-[15px] font-semibold text-fg",
  h2: "mt-4 mb-2 text-[14px] font-semibold text-fg",
  h3: "mt-3 mb-1 text-[13px] font-semibold text-fg",
  h4: "mt-3 mb-1 text-[13px] font-semibold text-fg2",
  h5: "mt-3 mb-1 text-[12px] font-semibold text-fg2",
  h6: "mt-3 mb-1 text-[12px] font-semibold text-dim",
};

function isTooDeep(text: string): boolean {
  return text.split("\n").some((line) => {
    const prefix = nestingPrefix.exec(line)?.[0] ?? "";
    const markers = prefix.match(/>|[-*+]|\d{1,9}[.)]/g)?.length ?? 0;
    const indent = prefix.replaceAll("\t", "    ").length - markers;
    return markers > 0 && markers + indent / 2 > deepestNesting;
  });
}

function isCostly(text: string): boolean {
  if ((text.match(emphasisCharacter)?.length ?? 0) > emphasisBudget) return true;
  if ((text.match(bracketCharacter)?.length ?? 0) > bracketBudget) return true;
  let rules = 0;
  for (const line of text.split("\n")) {
    if (ruleLine.test(line)) rules += 1;
  }
  return rules > ruleBudget;
}

function reveal(node: Nodes): void {
  if ("value" in node) node.value = visibleText(node.value);
  if (node.type === "image" || node.type === "imageReference") {
    node.alt = visibleText(node.alt ?? "");
  }
  if ("children" in node) node.children.forEach(reveal);
}

function revealAfterParse() {
  return (tree: Root) => {
    reveal(tree);
  };
}

function opened(address: string | undefined): string | null {
  const url = address === undefined ? null : URL.parse(address);
  if (url === null || url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    return null;
  }
  return url.href;
}

function heading(level: keyof typeof headingLook, tag: "h3" | "h4" | "h5" | "h6") {
  const Tag = tag;
  const look = headingLook[level];
  return ({ children }: { children?: ReactNode }) => <Tag className={look}>{children}</Tag>;
}

function components(onLink: (address: string) => void): Components {
  return {
    a({ href, children }) {
      const address = opened(href);
      if (address === null) return <>{children}</>;
      return (
        <button
          type="button"
          data-testid="markdown-link"
          data-address={address}
          className={linkLook}
          onClick={() => {
            onLink(address);
          }}
        >
          <InsideLink.Provider value>{children}</InsideLink.Provider>
        </button>
      );
    },
    img({ src, alt }) {
      const text = alt ?? "";
      const address = opened(src);
      if (address === null) return <>{text}</>;
      return <ImageLink address={address} alt={text} onLink={onLink} />;
    },
    input({ checked }) {
      return (
        <span
          aria-hidden
          className="mr-1.5 inline-block h-3 w-3 translate-y-[1px] rounded-[3px] border border-ctl text-center align-baseline text-[9px] leading-[11px] text-fg"
        >
          {checked === true ? "x" : ""}
        </span>
      );
    },
    h1: heading("h1", "h3"),
    h2: heading("h2", "h3"),
    h3: heading("h3", "h4"),
    h4: heading("h4", "h5"),
    h5: heading("h5", "h6"),
    h6: heading("h6", "h6"),
    p: ({ children }) => <p className="my-2 break-words">{children}</p>,
    ul: ({ children }) => <ul className="my-2 list-disc pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 list-decimal pl-5">{children}</ol>,
    li: ({ children }) => <li className="my-0.5">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-2 border-ctl pl-3 text-fg2">{children}</blockquote>
    ),
    pre: ({ children }) => (
      <pre className="my-2 overflow-x-auto rounded-[6px] border border-ctl bg-side p-2 font-mono text-[12px] text-fg">
        {children}
      </pre>
    ),
    code: ({ children }) => <code className="font-mono text-[12px]">{children}</code>,
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto">
        <table className="border-collapse text-[12px]">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border border-ctl px-2 py-1 text-left font-semibold">{children}</th>
    ),
    td: ({ children }) => <td className="border border-ctl px-2 py-1">{children}</td>,
    hr: () => <hr className="my-3 border-ctl" />,
  };
}

function ImageLink({
  address,
  alt,
  onLink,
}: {
  address: string;
  alt: string;
  onLink: (address: string) => void;
}) {
  const label = alt === "" ? "Image" : `Image ${alt}`;
  if (useContext(InsideLink)) {
    return (
      <span data-testid="markdown-image" data-address={address}>
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-testid="markdown-image"
      data-address={address}
      className={linkLook}
      onClick={() => {
        onLink(address);
      }}
    >
      {label}
    </button>
  );
}

function plain(text: string): ReactNode {
  return (
    <pre className="my-2 font-mono text-[12px] break-words whitespace-pre-wrap text-fg">
      {revealLines(text).text}
    </pre>
  );
}

function drawn(text: string, onLink: (address: string) => void): ReactNode {
  if (text.length > longestDrawn || isTooDeep(text) || isCostly(text)) return plain(text);
  try {
    return Markdown({
      remarkPlugins: [remarkGfm, revealAfterParse],
      skipHtml: true,
      components: components(onLink),
      children: text,
    });
  } catch {
    return plain(text);
  }
}

export function MarkdownText({ text, onLink }: MarkdownTextProps) {
  const body = useMemo(() => drawn(text, onLink), [text, onLink]);
  return (
    <div data-testid="markdown" className="min-w-0 text-[13px] leading-[1.5] text-fg">
      {body}
    </div>
  );
}

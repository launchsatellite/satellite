import type { Root } from "hast";
import { toJsxRuntime, type Components } from "hast-util-to-jsx-runtime";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { revealLines } from "../../shared/visible-text.ts";

export const plainSentence = "Shown as plain text because it could not be drawn safely in time.";

const InsideLink = createContext(false);

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

function opened(address: string | undefined): string | null {
  const url = address === undefined ? null : URL.parse(address);
  if (url?.protocol !== "https:" || url.username !== "" || url.password !== "") {
    return null;
  }
  return url.href;
}

function heading(level: keyof typeof headingLook, tag: "h3" | "h4" | "h5" | "h6") {
  const Tag = tag;
  const look = headingLook[level];
  return ({ children }: { children?: ReactNode }) => <Tag className={look}>{children}</Tag>;
}

function components(onLink: (address: string) => void): Partial<Components> {
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

function PlainText({ text, waiting }: { text: string; waiting: boolean }) {
  return (
    <>
      {!waiting && <p className="text-[12px] text-dim">{plainSentence}</p>}
      <pre className="my-2 font-mono text-[12px] break-words whitespace-pre-wrap text-fg">
        {revealLines(text).text}
      </pre>
    </>
  );
}

export function MarkdownBody({
  text,
  tree,
  waiting = false,
  onLink,
}: {
  text: string;
  tree: Root | null;
  waiting?: boolean;
  onLink: (address: string) => void;
}) {
  const drawn = useMemo(
    () =>
      tree === null
        ? null
        : toJsxRuntime(tree, {
            Fragment,
            components: components(onLink),
            ignoreInvalidStyle: true,
            jsx,
            jsxs,
            passKeys: true,
          }),
    [tree, onLink],
  );
  return (
    <div data-testid="markdown" className="min-w-0 text-[13px] leading-[1.5] text-fg">
      {drawn ?? <PlainText text={text} waiting={waiting} />}
    </div>
  );
}

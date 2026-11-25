import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  bridgeLimits,
  type SessionEnding,
  type WorkspaceRef,
} from "../../shared/bridge-contract.ts";
import { textChunks } from "../../shared/text-chunks.ts";
import { invoke, subscribe } from "../bridge/bridge-client.ts";
import type { PromptTarget } from "../sessions/send-to-claude-code.ts";
import { Button } from "../ui/button.tsx";
import { codeType } from "../ui/code-type.ts";
import { scrollbarLook } from "../ui/scrollbar-look.ts";
import { onThemeChange } from "../ui/shown-theme.ts";
import type { Notify } from "../ui/toast.tsx";
import { droppedPaths } from "./dropped-paths.ts";
import { gpuRenderer } from "./gpu-renderer.ts";
import { createHeldKeyGate } from "./held-keys.ts";
import { linkFollow } from "./link-follow.ts";
import { pastedText } from "./pasted-text.ts";
import { imagePasteSequence, isShiftEnter, newlineSequence, opensLink } from "./terminal-keys.ts";
import { terminalTheme } from "./terminal-theme.ts";

interface TerminalViewProps {
  terminalId: string;
  workspace: WorkspaceRef;
  resume: boolean;
  shown: boolean;
  onRestart: () => void;
  onStarted: () => void;
  onMissing: (sentence: string) => void;
  onAskLink: (address: string) => void;
  onPromptTarget: (id: string, target: PromptTarget) => () => void;
  notify: Notify;
}

const dropLimit = 20;
const dropPathChars = 4096;
const tooManyFiles = "Drop up to 20 files at a time.";
const unreadableFile = "Satellite couldn't read where that file came from.";
const unsafePath =
  "Satellite can't type a path that holds a line break or another control character.";
const endings: Record<SessionEnding, string> = {
  ended: "Claude Code ended.",
  unexpected: "Claude Code stopped unexpectedly. The workspace and its changes are safe.",
  "resume-failed":
    "Claude Code couldn't resume that session, so Satellite let it go. Start a new one.",
};

function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") === true;
}

function holdsOnlyFiles(data: DataTransfer | null): boolean {
  if (data === null || data.types.includes("text/plain")) return false;
  return [...data.items].some((item) => item.kind === "file");
}

export function TerminalView({
  terminalId,
  workspace,
  resume,
  shown,
  onRestart,
  onStarted,
  onMissing,
  onAskLink,
  onPromptTarget,
  notify,
}: TerminalViewProps) {
  const { projectId, workspace: key } = workspace;
  const host = useRef<HTMLDivElement>(null);
  const show = useRef<() => void>(undefined);
  const hide = useRef<() => void>(undefined);
  const prompt = useRef<PromptTarget>(undefined);
  const noticedNow = useRef(false);
  const outward = useRef({ onAskLink, notify, onMissing, onStarted });
  const [notice, setNotice] = useState<string>();
  const noticed = notice !== undefined;

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const follow = (event: MouseEvent, text: string) => {
      const step = linkFollow(text, opensLink(event));
      if (step === null) return;
      const { onAskLink: ask, notify: tell } = outward.current;
      if ("ask" in step) ask(step.ask);
      else tell(step.refuse, "error");
    };
    const terminal = new Terminal({
      fontFamily: codeType.fontFamily,
      fontSize: codeType.fontSize,
      lineHeight: codeType.terminalLineHeight,
      minimumContrastRatio: 4.5,
      rescaleOverlappingGlyphs: true,
      scrollback: 5000,
      overviewRuler: { width: scrollbarLook.gutter },
      allowProposedApi: true,
      theme: terminalTheme(),
      linkHandler: {
        activate: (event, text) => {
          follow(event, text);
        },
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new Unicode11Addon());
    terminal.loadAddon(
      new WebLinksAddon((event, text) => {
        follow(event, text);
      }),
    );
    terminal.unicode.activeVersion = "11";
    terminal.open(element);
    const fitted = () => {
      if (element.clientWidth === 0 || element.clientHeight === 0) return false;
      fit.fit();
      return true;
    };
    fitted();
    let sent = { cols: terminal.cols, rows: terminal.rows };

    const stopData = subscribe("terminal.data", ({ id, data }) => {
      if (id !== terminalId) return;
      terminal.write(data, () => {
        void invoke("terminal.ack", { id, chars: data.length });
      });
    });
    const end = (sentence: string) => {
      terminal.options.cursorInactiveStyle = "none";
      terminal.options.disableStdin = true;
      setNotice(sentence);
    };
    const stopExit = subscribe("terminal.exit", ({ id, ending }) => {
      if (id === terminalId) end(endings[ending]);
    });
    let current = true;
    let queue: Promise<unknown> = invoke("terminal.start", {
      id: terminalId,
      program: "claude",
      workspace: { projectId, workspace: key },
      resume,
      cols: sent.cols,
      rows: sent.rows,
    }).then((result) => {
      if (!current) return;
      if (result.ok) {
        if (result.value.windowsPty !== null) terminal.options.windowsPty = result.value.windowsPty;
        if (result.value.driven) Object.assign(element, { terminal });
        outward.current.onStarted();
        return;
      }
      if (result.error.code === "tool-missing") outward.current.onMissing(result.error.message);
      else end(result.error.message);
    });
    const send = (data: string) => {
      for (const chunk of textChunks(data, bridgeLimits.terminalWriteChars)) {
        queue = queue.then(() => invoke("terminal.write", { id: terminalId, data: chunk }));
      }
    };
    const sendSize = () => {
      if (!fitted()) return;
      const { cols, rows } = terminal;
      if (cols === sent.cols && rows === sent.rows) return;
      sent = { cols, rows };
      queue = queue.then(() => invoke("terminal.resize", { id: terminalId, cols, rows }));
    };
    const gpu = gpuRenderer(terminal, (renderer) => {
      element.setAttribute("data-renderer", renderer);
      sendSize();
    });

    const input = terminal.onData(send);
    const paste = (text: string) => {
      terminal.paste(pastedText(text));
    };
    const pasteClipboard = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      if (data === null) return;
      event.preventDefault();
      event.stopPropagation();
      if (holdsOnlyFiles(data)) send(imagePasteSequence());
      else paste(data.getData("text/plain"));
    };
    const dragOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length === 0) return;
      const { notify: tell } = outward.current;
      if (files.length > dropLimit) {
        tell(tooManyFiles, "error");
        return;
      }
      const paths = files.map((file) => window.satellite.pathForFile(file));
      if (paths.some((path) => path === "" || path.length > dropPathChars)) {
        tell(unreadableFile, "error");
        return;
      }
      const typed = droppedPaths(paths);
      if (typed === null) {
        tell(unsafePath, "error");
        return;
      }
      paste(typed);
      terminal.focus();
    };
    element.addEventListener("paste", pasteClipboard, true);
    element.addEventListener("dragover", dragOver);
    element.addEventListener("drop", drop);
    const held = createHeldKeyGate();
    const tookFocus = () => {
      held.focused();
    };
    element.addEventListener("focusin", tookFocus);
    terminal.attachCustomKeyEventHandler((event) => {
      if (!held.allows(event)) {
        event.preventDefault();
        return false;
      }
      if (!isShiftEnter(event)) return true;
      if (event.type === "keydown") send(newlineSequence);
      return false;
    });

    let frame = 0;
    const refit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sendSize);
    };
    const observer = new ResizeObserver(refit);
    observer.observe(element);
    let scale = matchMedia(`(resolution: ${String(devicePixelRatio)}dppx)`);
    const rescaled = () => {
      scale.removeEventListener("change", rescaled);
      scale = matchMedia(`(resolution: ${String(devicePixelRatio)}dppx)`);
      scale.addEventListener("change", rescaled);
      refit();
    };
    scale.addEventListener("change", rescaled);
    const sight = new IntersectionObserver((entries) => {
      if (entries.at(-1)?.isIntersecting !== true || !element.checkVisibility()) return;
      gpu.take();
      sendSize();
    });
    sight.observe(element);
    show.current = () => {
      if (!noticedNow.current) terminal.focus();
    };
    hide.current = () => {
      gpu.release();
      sight.unobserve(element);
      sight.observe(element);
    };
    prompt.current = {
      paste,
      focus: () => {
        terminal.focus();
      },
    };

    const stopTheme = onThemeChange(() => {
      terminal.options.theme = terminalTheme();
    });

    return () => {
      current = false;
      show.current = undefined;
      hide.current = undefined;
      prompt.current = undefined;
      element.removeEventListener("paste", pasteClipboard, true);
      element.removeEventListener("dragover", dragOver);
      element.removeEventListener("drop", drop);
      element.removeEventListener("focusin", tookFocus);
      stopTheme();
      observer.disconnect();
      sight.disconnect();
      scale.removeEventListener("change", rescaled);
      cancelAnimationFrame(frame);
      input.dispose();
      stopData();
      stopExit();
      gpu.end();
      void invoke("terminal.close", { id: terminalId });
    };
  }, [terminalId, projectId, key, resume]);

  useEffect(() => {
    noticedNow.current = noticed;
  }, [noticed]);

  useEffect(() => {
    const target = prompt.current;
    if (noticed || target === undefined) return;
    return onPromptTarget(terminalId, target);
  }, [terminalId, projectId, key, resume, noticed, onPromptTarget]);

  useEffect(() => {
    outward.current = { onAskLink, notify, onMissing, onStarted };
  }, [onAskLink, notify, onMissing, onStarted]);

  useLayoutEffect(() => {
    if (!shown) hide.current?.();
  }, [shown]);

  useEffect(() => {
    if (shown) show.current?.();
  }, [shown]);

  return (
    <div
      data-testid={shown ? "terminal" : undefined}
      className="flex h-full min-h-0 flex-col bg-bg p-2"
    >
      <div ref={host} className="min-h-0 flex-1" />
      {shown && (
        <div className={`flex flex-col gap-2 px-1 ${noticed ? "pt-2" : ""}`}>
          <div className="flex flex-wrap items-center gap-3">
            <p role="status" data-testid="terminal-notice" className="text-[13px] text-fg2">
              {notice}
            </p>
            {noticed && (
              <Button
                testId="start-claude"
                onClick={onRestart}
                autoFocus={notice === endings.ended}
              >
                Start Claude Code
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { WorkspaceRef } from "../../shared/bridge-contract.ts";
import type { Command } from "../commands/command-registry.ts";
import { commandShortcut, useCommands } from "../commands/commands-context.tsx";
import { Icon } from "../ui/icon.tsx";
import { KeyHint } from "../ui/key-hint.tsx";
import { StatusPixel } from "../ui/status-pixel.tsx";
import { withUniqueTestIds } from "../ui/unique-test-ids.ts";
import { rankMatches } from "../../shared/fuzzy-match.ts";
import { visibleText } from "../../shared/visible-text.ts";
import { FileIcon, useIcons, type LoadedIcons } from "../files/file-icon.tsx";
import { findSentence, typeAFileNameSentence } from "../files/file-words.ts";
import type { FileSearch } from "../files/use-file-search.ts";

type PaletteMode = "commands" | "switcher" | "files";

export interface SwitcherItem {
  ref: WorkspaceRef;
  label: string;
  testKey: string;
  project: string;
  parent?: string;
}

interface PaletteProps {
  mode: PaletteMode;
  onClose: () => void;
  switcher: readonly SwitcherItem[];
  onOpenWorkspace: (ref: WorkspaceRef) => void;
  files: FileSearch;
  onOpenFile: (path: string) => void;
  onQuery: (query: string) => void;
}
interface PaletteOption {
  key: string;
  testId: string;
  title: string;
  hint?: string;
  detail?: string;
  pixel?: boolean;
  path?: string;
  run: () => void;
}

const queryLimit = 200;
const activeRow = "bg-sel outline-1 -outline-offset-1 outline-accent";
const copy = {
  commands: {
    label: "Command menu",
    placeholder: "Type a command",
    group: "Commands",
    action: "Run",
  },
  switcher: {
    label: "Go to a workspace",
    placeholder: "Type part of a workspace or project name",
    group: "Workspaces",
    action: "Open",
  },
  files: {
    label: "Open a file by name",
    placeholder: "Type part of a file name",
    group: "Files",
    action: "Open",
  },
};

function commandOptions(query: string, commands: readonly Command[]): PaletteOption[] {
  const listed = commands.filter(
    (command) => command.available && command.id !== "palette.commands",
  );
  return rankMatches(query, listed, (command) => command.title).map((command) => ({
    key: command.id,
    testId: `command-${command.id.replaceAll(".", "-")}`,
    title: command.title,
    hint: commandShortcut(command),
    run: command.run,
  }));
}

function switcherOptions(
  query: string,
  switcher: readonly SwitcherItem[],
  onOpenWorkspace: (ref: WorkspaceRef) => void,
): PaletteOption[] {
  const ranked = rankMatches(
    query,
    switcher,
    (item) => `${item.label} ${item.project} ${item.parent ?? ""}`,
  );
  return withUniqueTestIds(
    ranked.map((item) => ({
      key: `${item.ref.projectId}/${item.ref.workspace}`,
      testId: `switch-${item.project}-${item.testKey}`,
      title: item.label,
      detail: item.parent === undefined ? item.project : `${item.project} · ${item.parent}`,
      pixel: true,
      run: () => {
        onOpenWorkspace(item.ref);
      },
    })),
  );
}

function fileOptions(
  paths: readonly string[],
  onOpenFile: (path: string) => void,
): PaletteOption[] {
  return paths.map((path, index) => {
    const at = path.lastIndexOf("/");
    return {
      key: path,
      testId: `file-result-${String(index)}`,
      title: visibleText(path.slice(at + 1)),
      detail: at === -1 ? undefined : visibleText(path.slice(0, at)),
      path,
      run: () => {
        onOpenFile(path);
      },
    };
  });
}

function emptyNote(
  mode: PaletteMode,
  query: string,
  files: FileSearch,
): { testId: string; text: string } | undefined {
  if (mode !== "files") return { testId: "palette-empty", text: "Nothing matches that." };
  if (query === "" || files.state === "idle") {
    return { testId: "palette-note", text: typeAFileNameSentence };
  }
  if (files.query !== query || files.state === "searching") return undefined;
  if (files.state === "found") return { testId: "palette-empty", text: "Nothing matches that." };
  return { testId: "palette-note", text: findSentence(files.state) };
}

function OptionIcon({ icons, path }: { icons: LoadedIcons | undefined; path: string }) {
  return (
    <FileIcon
      icons={icons}
      name={path.slice(path.lastIndexOf("/") + 1)}
      folder={false}
      open={false}
    />
  );
}

function FooterHint({ keys, action }: { keys: string; action: string }) {
  return (
    <span className="inline-flex items-center gap-[5px]">
      <KeyHint keys={keys} plain />
      {action}
    </span>
  );
}

export function Palette({
  mode,
  onClose,
  switcher,
  onOpenWorkspace,
  files,
  onOpenFile,
  onQuery,
}: PaletteProps) {
  const { commands } = useCommands();
  const icons = useIcons();
  const listId = useId();
  const groupLabelId = useId();
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);
  const restored = useRef(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [shownMode, setShownMode] = useState(mode);
  if (shownMode !== mode) {
    setShownMode(mode);
    setQuery("");
    setActive(0);
  }
  const [shownPaths, setShownPaths] = useState(files.paths);
  if (shownPaths !== files.paths) {
    setShownPaths(files.paths);
    setActive(0);
  }

  const restoreFocus = () => {
    if (restored.current) return;
    restored.current = true;
    const element = opener.current;
    if (element instanceof HTMLElement && element.isConnected) element.focus();
  };
  const close = () => {
    restoreFocus();
    onClose();
  };

  useLayoutEffect(() => {
    opener.current = document.activeElement;
    restored.current = false;
    return restoreFocus;
  }, []);
  useEffect(() => {
    restored.current = false;
    input.current?.focus();
  }, [mode]);

  const options = useMemo(() => {
    if (mode === "commands") return commandOptions(query, commands);
    if (mode === "files") return fileOptions(files.paths, onOpenFile);
    return switcherOptions(query, switcher, onOpenWorkspace);
  }, [mode, query, commands, switcher, onOpenWorkspace, files.paths, onOpenFile]);
  const stale = mode === "files" && (files.query !== query || files.state === "searching");
  const optionId = (index: number) => `${listId}-${String(index)}`;
  const activeOption = options[active];

  useEffect(() => {
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
  });

  const runOption = (option: PaletteOption) => {
    close();
    option.run();
  };
  const press = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((active + step + options.length) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeOption !== undefined && !stale) runOption(activeOption);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      event.preventDefault();
    }
  };
  const text = copy[mode];
  const note = emptyNote(mode, query, files);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-bg/60" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={text.label}
        data-testid="palette"
        className="absolute top-[12vh] left-1/2 w-[min(560px,calc(100%-32px))] -translate-x-1/2 overflow-hidden rounded-[12px] border border-line bg-raised shadow-raised"
        onMouseDown={(event) => {
          if (event.target !== input.current) event.preventDefault();
        }}
      >
        <div className="flex h-11 items-center gap-2 border-b border-line px-[14px] text-dim">
          <Icon name="search" />
          <input
            ref={input}
            data-testid="palette-input"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeOption === undefined ? undefined : optionId(active)}
            aria-label={text.label}
            placeholder={text.placeholder}
            spellCheck={false}
            autoComplete="off"
            maxLength={queryLimit}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              if (mode === "files") onQuery(event.target.value);
            }}
            onKeyDown={press}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-dim"
          />
          <KeyHint keys="Esc" />
        </div>
        <div className="max-h-[360px] overflow-y-auto p-[6px]">
          <div id={listId} role="listbox" aria-label={text.group}>
            <div role="group" aria-labelledby={groupLabelId}>
              <div
                id={groupLabelId}
                role="presentation"
                className="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-[0.12em] text-dim uppercase"
              >
                {text.group}
              </div>
              {options.map((option, index) => (
                <div
                  key={option.key}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  data-testid={option.testId}
                  data-path={option.path}
                  title={option.path === undefined ? undefined : visibleText(option.path)}
                  aria-label={option.path === undefined ? undefined : visibleText(option.path)}
                  className={`flex h-8 items-center gap-[9px] rounded-[6px] px-[9px] text-[13px] font-medium text-fg2 ${index === active ? activeRow : ""}`}
                  onMouseMove={() => {
                    if (index !== active) setActive(index);
                  }}
                  onClick={() => {
                    runOption(option);
                  }}
                >
                  {option.pixel === true && <StatusPixel state="idle" size={6} />}
                  {option.path !== undefined && <OptionIcon icons={icons} path={option.path} />}
                  <span
                    className={`min-w-0 truncate text-fg ${index === active ? "font-semibold" : ""}`}
                  >
                    {option.title}
                  </span>
                  {option.detail !== undefined && (
                    <span
                      className={`ml-auto max-w-[45%] truncate text-[12px] text-dim ${option.path === undefined ? "flex-none" : "min-w-0 text-left [direction:rtl]"}`}
                    >
                      {option.path === undefined ? (
                        option.detail
                      ) : (
                        <span dir="ltr" className="[unicode-bidi:isolate]">
                          {option.detail}
                        </span>
                      )}
                    </span>
                  )}
                  {option.hint !== undefined && (
                    <span className="ml-auto flex-none">
                      <KeyHint keys={option.hint} plain />
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div role="status">
            {options.length === 0 && note !== undefined && (
              <p data-testid={note.testId} className="px-[9px] py-2 text-[13px] text-dim">
                {note.text}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-[14px] border-t border-line px-[14px] py-2 text-[11px] text-dim">
          <FooterHint keys="↑↓" action="Move" />
          <FooterHint keys="↵" action={text.action} />
          <FooterHint keys="Esc" action="Close" />
        </div>
      </div>
    </div>
  );
}

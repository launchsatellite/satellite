import type { ChangesList } from "../../shared/bridge-contract.ts";
import { CommandButton } from "../commands/commands-context.tsx";
import { Icon } from "../ui/icon.tsx";
import { VisibleName } from "../ui/visible-name.tsx";
import { conflictCount, conflictNote } from "./change-words.ts";

interface ConflictBannerProps {
  base: string | null;
  conflict: ChangesList["conflict"];
}

function Names({ names, files }: { names: readonly string[]; files: number }) {
  if (names.length === 0) return null;
  const rest = files - names.length;
  return (
    <span
      data-testid="changes-banner-files"
      className="min-w-0 shrink-[3] truncate font-mono text-[12px]"
    >
      {names.map((name, index) => (
        <span key={name}>
          {index > 0 && ", "}
          <span dir="ltr" className="[unicode-bidi:isolate]">
            <VisibleName text={name} />
          </span>
        </span>
      ))}
      {rest > 0 && `, and ${String(rest)} more`}
    </span>
  );
}

function Message({
  base,
  conflict,
}: {
  base: string | null;
  conflict: NonNullable<ConflictBannerProps["conflict"]>;
}) {
  if (conflict.kind !== "files")
    return <span className="min-w-0 truncate">{conflictNote(conflict.kind, base)}</span>;
  return (
    <>
      <span className="min-w-0 truncate">
        <span dir="ltr" className="[unicode-bidi:isolate]">
          {base === null ? "The base branch" : <VisibleName text={base} />}
        </span>{" "}
        moved, and {conflictCount(conflict.files)} with this branch.
      </span>
      <Names names={conflict.names} files={conflict.files} />
    </>
  );
}

export function ConflictBanner({ base, conflict }: ConflictBannerProps) {
  if (base === null) return null;
  return (
    <div role="status" className="flex-none">
      {conflict !== null && (
        <div
          data-testid="changes-banner"
          className="flex h-9 items-center gap-2 border-b border-line bg-side px-4 py-2 text-[13px] text-fg2"
        >
          <span className="flex-none text-dim">
            <Icon name="branch" size={13} />
          </span>
          <Message base={base} conflict={conflict} />
          {conflict.kind === "files" && (
            <span className="ml-auto flex-none">
              <CommandButton
                command="changes.update-from-base"
                variant="secondary"
                size="small"
                testId="changes-banner-send"
              >
                Send to Claude Code
              </CommandButton>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

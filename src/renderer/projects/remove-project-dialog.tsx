import type { ReactNode } from "react";
import { visibleText } from "../../shared/visible-text.ts";
import { Button } from "../ui/button.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { StatusPixel } from "../ui/status-pixel.tsx";

interface RemoveProjectDialogProps {
  name: string;
  sessions: number;
  processes: number;
  onClose: () => void;
  onRemove: () => void;
}

function sessionsSentence(count: number): string {
  return count === 1
    ? "1 Claude Code session running here stops first."
    : `${String(count)} Claude Code sessions running here stop first.`;
}

function processesSentence(count: number): string {
  return count === 1
    ? "1 running process it started stops with it."
    : `${String(count)} running processes they started stop with them.`;
}

function Row({ testId, children }: { testId?: string; children: ReactNode }) {
  return (
    <div data-testid={testId} className="flex min-h-8 items-start gap-[10px] py-[6px] text-[13px]">
      <span className="mt-[6px] flex flex-none">
        <StatusPixel state="idle" />
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

export function RemoveProjectDialog({
  name,
  sessions,
  processes,
  onClose,
  onRemove,
}: RemoveProjectDialogProps) {
  return (
    <Dialog
      title={`Remove ${visibleText(name)}`}
      description="Satellite forgets this repo. Its folder stays where it is."
      testId="remove-project-dialog"
      onClose={onClose}
      closable
      footer={
        <>
          <Button variant="ghost" onClick={onClose} testId="remove-project-cancel" autoFocus>
            Cancel
          </Button>
          <Button onClick={onRemove} testId="remove-project-confirm">
            Remove repo
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1">
        {sessions > 0 && <Row testId="remove-project-sessions">{sessionsSentence(sessions)}</Row>}
        {processes > 0 && (
          <Row testId="remove-project-processes">{processesSentence(processes)}</Row>
        )}
        <Row>
          Claude Code keeps each conversation, so{" "}
          <span className="font-mono text-[12px]">claude --resume</span> in the folder picks it up
          again.
        </Row>
      </div>
    </Dialog>
  );
}

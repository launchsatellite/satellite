import { invoke } from "../bridge/bridge-client.ts";
import { Button } from "../ui/button.tsx";
import { Dialog } from "../ui/dialog.tsx";
import type { Notify } from "../ui/toast.tsx";

interface LinkDialogProps {
  address: string;
  onClose: () => void;
  notify: Notify;
}

const label = "text-[12px] text-dim";
const mono = "font-mono text-[12px] break-all text-fg select-all";

async function openLink(url: string, notify: Notify): Promise<boolean> {
  const result = await invoke("links.open", { url });
  if (!result.ok) notify(result.error.message, "error");
  return result.ok;
}

export function LinkDialog({ address, onClose, notify }: LinkDialogProps) {
  const host = URL.parse(address)?.host ?? "";
  return (
    <Dialog
      title="Open this link"
      description="The text Claude Code showed points to this address. Check it before you open it."
      testId="link-dialog"
      onClose={onClose}
      closable
      footer={
        <>
          <span className="mr-auto">
            <Button variant="ghost" onClick={onClose} testId="link-cancel" autoFocus>
              Cancel
            </Button>
          </span>
          <Button
            onClick={() => {
              void openLink(address, notify).then((opened) => {
                if (opened) onClose();
              });
            }}
            testId="link-open"
          >
            Open in browser
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1">
        <p className={label}>Site</p>
        <p data-testid="link-host" className={`${mono} font-semibold`}>
          {host}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <p className={label}>Address</p>
        <p
          data-testid="link-address"
          className={`${mono} max-h-[160px] overflow-y-auto rounded-[6px] border border-ctl bg-side px-2 py-1`}
        >
          {address}
        </p>
      </div>
    </Dialog>
  );
}

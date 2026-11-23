import { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal } from "@xterm/xterm";

export type TerminalRenderer = "webgl" | "dom";

export interface GpuRenderer {
  take: () => void;
  release: () => void;
}

let refused = false;

function canvasesOf(terminal: Terminal): Set<HTMLCanvasElement> {
  return new Set(terminal.element?.querySelectorAll("canvas") ?? []);
}

export function gpuRenderer(
  terminal: Terminal,
  drawnBy: (renderer: TerminalRenderer) => void,
): GpuRenderer {
  let addon: WebglAddon | undefined;
  let own: HTMLCanvasElement[] = [];
  const release = () => {
    if (addon === undefined) return;
    const held = own;
    addon.dispose();
    addon = undefined;
    own = [];
    for (const canvas of held) {
      canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
    }
    drawnBy("dom");
  };
  const take = () => {
    if (addon !== undefined || refused) return;
    const before = canvasesOf(terminal);
    const candidate = new WebglAddon();
    try {
      terminal.loadAddon(candidate);
    } catch {
      refused = true;
      candidate.dispose();
      return;
    }
    addon = candidate;
    own = [...canvasesOf(terminal)].filter((canvas) => !before.has(canvas));
    candidate.onContextLoss(release);
    drawnBy("webgl");
  };
  drawnBy("dom");
  return { take, release };
}

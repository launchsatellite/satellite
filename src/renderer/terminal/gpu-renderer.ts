import { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal } from "@xterm/xterm";

export type TerminalRenderer = "webgl" | "dom";

export interface GpuRenderer {
  take: () => void;
  release: () => void;
  end: () => void;
}

let refused = false;

function screenCanvases(terminal: Terminal): HTMLCanvasElement[] {
  return [...(terminal.element?.querySelectorAll<HTMLCanvasElement>(".xterm-screen canvas") ?? [])];
}

function letGo(canvases: HTMLCanvasElement[]): void {
  for (const canvas of canvases) {
    const context = canvas.getContext("webgl2");
    if (context !== null && !context.isContextLost()) {
      context.getExtension("WEBGL_lose_context")?.loseContext();
    }
    canvas.remove();
  }
}

export function gpuRenderer(
  terminal: Terminal,
  drawnBy: (renderer: TerminalRenderer) => void,
): GpuRenderer {
  let addon: WebglAddon | undefined;
  const release = () => {
    if (addon === undefined) return;
    const canvases = screenCanvases(terminal);
    addon.dispose();
    addon = undefined;
    letGo(canvases);
    drawnBy("dom");
  };
  const take = () => {
    if (addon !== undefined || refused) return;
    const candidate = new WebglAddon();
    try {
      terminal.loadAddon(candidate);
    } catch {
      refused = true;
      candidate.dispose();
      letGo(screenCanvases(terminal));
      return;
    }
    addon = candidate;
    candidate.onContextLoss(release);
    drawnBy("webgl");
  };
  const end = () => {
    const canvases = screenCanvases(terminal);
    addon = undefined;
    terminal.dispose();
    letGo(canvases);
  };
  drawnBy("dom");
  return { take, release, end };
}

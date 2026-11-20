import { bridgeLimits } from "../../shared/bridge-contract.ts";
import { textChunks } from "../../shared/text-chunks.ts";

export interface OutputSink {
  emit(chunk: string): void;
  pause(): void;
  resume(): void;
}

export interface OutputFlow {
  push(data: string): void;
  ack(chars: number): void;
  finish(): void;
  stop(): void;
}

export const outputFlowLimits = {
  flushMs: 8,
  chunkChars: bridgeLimits.terminalOutputChars,
  highWater: 256 * 1024,
  lowWater: 32 * 1024,
};

export function createOutputFlow(sink: OutputSink): OutputFlow {
  let pending = "";
  let unacked = 0;
  let paused = false;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    const chunks = textChunks(pending, outputFlowLimits.chunkChars);
    pending = "";
    for (const chunk of chunks) {
      unacked += chunk.length;
      sink.emit(chunk);
    }
    if (!paused && unacked > outputFlowLimits.highWater) {
      paused = true;
      sink.pause();
    }
  };

  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    pending = "";
    if (paused) {
      paused = false;
      sink.resume();
    }
  };

  return {
    push(data) {
      if (stopped) return;
      pending += data;
      if (pending.length >= outputFlowLimits.chunkChars) flush();
      else timer ??= setTimeout(flush, outputFlowLimits.flushMs);
    },
    ack(chars) {
      unacked -= Math.min(chars, unacked);
      if (paused && !stopped && unacked <= outputFlowLimits.lowWater) {
        paused = false;
        sink.resume();
      }
    },
    finish() {
      if (stopped) return;
      flush();
      stop();
    },
    stop,
  };
}

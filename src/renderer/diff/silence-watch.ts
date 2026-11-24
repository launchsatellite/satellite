export interface SilenceWatch {
  sent: () => void;
  heard: (stillWaiting: boolean) => void;
  stop: () => void;
}

export function silenceWatch(silentMs: number, onSilent: () => void): SilenceWatch {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (deadline !== undefined) clearTimeout(deadline);
    deadline = undefined;
  };
  const arm = () => {
    deadline = setTimeout(() => {
      deadline = undefined;
      onSilent();
    }, silentMs);
  };
  return {
    sent: () => {
      if (deadline === undefined) arm();
    },
    heard: (stillWaiting) => {
      stop();
      if (stillWaiting) arm();
    },
    stop,
  };
}

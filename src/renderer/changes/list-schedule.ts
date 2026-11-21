export interface ScheduleAnswer {
  files: boolean;
  key: string;
}
export interface ScheduleHooks {
  read(): Promise<ScheduleAnswer>;
  visible(): boolean;
  now(): number;
  after(ms: number, run: () => void): () => void;
}
export interface Schedule {
  start(): void;
  stop(): void;
  refresh(): void;
  calm(): void;
  hide(): void;
}

export const changesPollMs = 2000;
export const changesPollMaxMs = 30_000;
export const changesPollFactor = 4;

export function pollDelay(elapsedMs: number, steps: number): number {
  const backoff = changesPollMs * 2 ** steps;
  return Math.min(changesPollMaxMs, Math.max(backoff, changesPollFactor * elapsedMs));
}

export function nextSteps(steps: number, answeredFiles: boolean, changed: boolean): number {
  return answeredFiles && changed ? 0 : steps + 1;
}

export function createSchedule(hooks: ScheduleHooks): Schedule {
  let stopped = false;
  let running = false;
  let again = false;
  let steps = 0;
  let last = "";
  let cancel: (() => void) | undefined;
  const clear = () => {
    cancel?.();
    cancel = undefined;
  };
  const ask = () => {
    clear();
    if (stopped || !hooks.visible()) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    const began = hooks.now();
    void hooks.read().then((answer) => {
      running = false;
      if (stopped) return;
      steps = nextSteps(steps, answer.files, answer.key !== last);
      last = answer.key;
      if (again) {
        again = false;
        ask();
      } else if (hooks.visible()) {
        cancel = hooks.after(pollDelay(hooks.now() - began, steps), ask);
      }
    });
  };
  return {
    start: ask,
    stop() {
      stopped = true;
      clear();
    },
    refresh() {
      steps = -1;
      ask();
    },
    calm() {
      steps = -1;
      if (cancel === undefined) return;
      clear();
      cancel = hooks.after(changesPollMs, ask);
    },
    hide: clear,
  };
}

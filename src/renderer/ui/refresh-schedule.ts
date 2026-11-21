export interface ScheduleAnswer {
  files: boolean;
  key: string;
}
interface ScheduleHooks {
  read(): Promise<ScheduleAnswer>;
  visible(): boolean;
  now(): number;
  after(ms: number, run: () => void): () => void;
}
interface Schedule {
  start: () => void;
  stop: () => void;
  refresh: () => void;
  calm: () => void;
  hide: () => void;
}

export interface Pace {
  firstMs: number;
  maxMs: number;
  factor: number;
}

const defaultPace: Pace = { firstMs: 2000, maxMs: 30_000, factor: 4 };

export function pollDelay(elapsedMs: number, steps: number, pace: Pace = defaultPace): number {
  const backoff = pace.firstMs * 2 ** steps;
  return Math.min(pace.maxMs, Math.max(backoff, pace.factor * elapsedMs));
}

export function nextSteps(steps: number, answeredFiles: boolean, changed: boolean): number {
  return answeredFiles && changed ? 0 : steps + 1;
}

export function createSchedule(hooks: ScheduleHooks, pace: Pace = defaultPace): Schedule {
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
        cancel = hooks.after(pollDelay(hooks.now() - began, steps, pace), ask);
      }
    });
  };
  return {
    start: ask,
    stop: () => {
      stopped = true;
      clear();
    },
    refresh: () => {
      steps = -1;
      ask();
    },
    calm: () => {
      steps = -1;
      if (cancel === undefined) return;
      clear();
      cancel = hooks.after(pace.firstMs, ask);
    },
    hide: clear,
  };
}

export const detachedSentence =
  "A process that detached from the session that started it keeps running and isn't listed here.";
export const nothingRunning = "Nothing is running here.";
export const portLinkSentence =
  "A process an agent started in this workspace listens on this port. Check the address before you open it.";

const secondsPerMinute = 60;
const minutesPerHour = 60;
const hoursPerDay = 24;

function unit(count: number, name: string): string {
  return `${String(count)} ${name}${count === 1 ? "" : "s"}`;
}

function parts(ms: number): { days: number; hours: number; minutes: number; seconds: number } {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutesTotal = Math.floor(total / secondsPerMinute);
  const hoursTotal = Math.floor(minutesTotal / minutesPerHour);
  return {
    days: Math.floor(hoursTotal / hoursPerDay),
    hours: hoursTotal % hoursPerDay,
    minutes: minutesTotal % minutesPerHour,
    seconds: total % secondsPerMinute,
  };
}

export function countLabel(count: number): string {
  return count === 1 ? "1 running process" : `${String(count)} running processes`;
}

export function moreSentence(more: number): string {
  return more === 1
    ? "1 more process is not listed."
    : `${String(more)} more processes are not listed.`;
}

export function ageReadout(ms: number): string {
  const { days, hours, minutes, seconds } = parts(ms);
  if (days > 0) return `${String(days)}D ${String(hours)}H`;
  if (hours > 0) return `${String(hours)}H ${String(minutes).padStart(2, "0")}M`;
  if (minutes > 0) return `${String(minutes)}M`;
  return `${String(seconds)}S`;
}

export function ageWords(ms: number): string {
  const { days, hours, minutes, seconds } = parts(ms);
  if (days > 0) return [unit(days, "day"), hours > 0 ? unit(hours, "hour") : ""].join(" ").trim();
  if (hours > 0) {
    return [unit(hours, "hour"), minutes > 0 ? unit(minutes, "minute") : ""].join(" ").trim();
  }
  if (minutes > 0) return unit(minutes, "minute");
  return unit(seconds, "second");
}

export function portLabel(port: number, linked: boolean): string {
  return linked
    ? `Open port ${String(port)} in your browser`
    : `Port ${String(port)} is bound to another address, so Satellite doesn't open it`;
}

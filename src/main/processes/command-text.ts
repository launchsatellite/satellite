import { processesLimits } from "../../shared/bridge-contract.ts";

const commandWindow = 1000;
const secretName = "token|secret|password|passwd|pwd|key|auth|credential|cookie|bearer";
const addressUser = /([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi;
const secretAssignment = new RegExp(`^(-{0,2}[^=\\s]*(?:${secretName})[^=\\s]*=)(.+)$`, "i");
const secretFlag = new RegExp(`^-{1,2}[^=\\s]*(?:${secretName})[^=\\s]*$`, "i");
const opaqueRun = /[A-Za-z0-9_+=-]{32,}/g;
const highSurrogate = /[\uD800-\uDBFF]/;

function windowOf(raw: string): { text: string; cut: boolean } {
  if (raw.length <= commandWindow) return { text: raw, cut: false };
  const head = raw.slice(0, commandWindow);
  if (/\s/.test(raw.charAt(commandWindow))) return { text: head, cut: true };
  return { text: head.slice(0, Math.max(0, head.search(/\s\S*$/))), cut: true };
}

function hidden(words: readonly string[]): string[] {
  const shown: string[] = [];
  let hideNext = false;
  for (const word of words) {
    if (hideNext && !word.startsWith("-")) {
      shown.push("***");
      hideNext = false;
      continue;
    }
    hideNext = secretFlag.test(word) || /^(?:bearer|basic)$/i.test(word);
    const noUser = word.replace(addressUser, "$1***@");
    const noValue = noUser.replace(secretAssignment, "$1***");
    shown.push(noValue.replace(opaqueRun, "***"));
  }
  return shown;
}

export function shownCommand(raw: string): { text: string; cut: boolean } {
  const window = windowOf(raw);
  const text = hidden(window.text.split(/\s+/).filter((word) => word !== "")).join(" ");
  if (text.length <= processesLimits.commandChars) return { text, cut: window.cut };
  const end = processesLimits.commandChars;
  const safeEnd = highSurrogate.test(text.charAt(end - 1)) ? end - 1 : end;
  return { text: text.slice(0, safeEnd), cut: true };
}

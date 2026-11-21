import { processesLimits } from "../../shared/bridge-contract.ts";

const commandWindow = 1000;
const secretName = "token|secret|password|passwd|pwd|pass|key|auth|credential|cookie|bearer";
const addressUser = /([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi;
const bareUser = /^([^\s:@/]+:)[^\s@/]+@/;
const secretAssignment = new RegExp(`^(-{0,2}[^=\\s]*(?:${secretName})[^=\\s]*=)(.+)$`, "i");
const secretQuery = new RegExp(`([?&;][^=&\\s]*(?:${secretName})[^=&\\s]*=)[^&\\s]*`, "gi");
const secretHeader = new RegExp(`^["']?[^:=\\s]*(?:${secretName})[^:=\\s]*:`, "i");
const secretFlag = new RegExp(`^-{1,2}[^=\\s]*(?:${secretName})[^=\\s]*$`, "i");
const scheme = /^(?:bearer|basic)$/i;
const opaqueRun = /[A-Za-z0-9_+=-]{32,}/g;
const highSurrogate = /[\uD800-\uDBFF]/;

function windowOf(raw: string): { text: string; cut: boolean } {
  if (raw.length <= commandWindow) return { text: raw, cut: false };
  const head = raw.slice(0, commandWindow);
  if (/\s/.test(raw.charAt(commandWindow))) return { text: head, cut: true };
  return { text: head.slice(0, Math.max(0, head.search(/\s\S*$/))), cut: true };
}

function opensQuote(value: string): string | undefined {
  const quote = value.charAt(0);
  if (quote !== '"' && quote !== "'") return undefined;
  return value.length > 1 && value.endsWith(quote) ? undefined : quote;
}

function hidden(words: readonly string[]): string[] {
  const shown: string[] = [];
  let hideNext = false;
  let openQuote: string | undefined;
  for (const word of words) {
    if (openQuote !== undefined) {
      shown.push("***");
      if (word.endsWith(openQuote)) openQuote = undefined;
      continue;
    }
    if (hideNext && !word.startsWith("-")) {
      if (scheme.test(word)) {
        shown.push(word);
        continue;
      }
      shown.push("***");
      hideNext = false;
      openQuote = opensQuote(word);
      continue;
    }
    const header = secretHeader.exec(word);
    hideNext =
      secretFlag.test(word) || scheme.test(word) || (header !== null && header[0] === word);
    const assigned = secretAssignment.exec(word);
    if (assigned !== null) openQuote = opensQuote(assigned[2] ?? "");
    const attached = header !== null && header[0] !== word ? `${header[0]}***` : word;
    const noUser = attached.replace(addressUser, "$1***@").replace(bareUser, "$1***@");
    const noValue = noUser.replace(secretAssignment, "$1***").replace(secretQuery, "$1***");
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

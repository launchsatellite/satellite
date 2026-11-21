import { processesLimits } from "../../shared/bridge-contract.ts";

const commandWindow = 1000;
const secretSuffix =
  /(?:token|secret|password|passwd|pwd|key|credential|cookie)s?$|auth(?:orization)?$|bearer$/;
const addressUser = /([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi;
const bareUser = /^([^\s:@/]+:)[^\s@/]+@/;
const assignment = /^(-{0,2}([^=\s]+)=)(.+)$/;
const query = /([?&;])([^=&\s]+)=[^&\s]*/g;
const headerWord = /^["']?([^:=\s]+):/;
const flagWord = /^-{1,2}([^=\s]+)$/;
const userFlag = /^(?:-u|--user|--proxy-user)$/;
const userAssignment = /^(--(?:proxy-)?user=[^:\s=]+:)(.+)$/;
const scheme = /^(?:bearer|basic)$/i;
const opaqueRun = /[A-Za-z0-9_+=-]{32,}/g;
const highSurrogate = /[\uD800-\uDBFF]/;

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tildeHome(raw: string, home: string): string {
  const folder = home.replace(/[\\/]+$/, "");
  if (folder === "") return raw;
  const boundary = new RegExp(
    `(^|[^\\w./\\\\~-])${escaped(folder)}(?=[\\\\/\\s"']|$)`,
    process.platform === "win32" ? "gi" : "g",
  );
  return raw.replace(boundary, "$1~");
}

function windowOf(raw: string): { text: string; cut: boolean } {
  if (raw.length <= commandWindow) return { text: raw, cut: false };
  const head = raw.slice(0, commandWindow);
  if (/\s/.test(raw.charAt(commandWindow))) return { text: head, cut: true };
  return { text: head.slice(0, Math.max(0, head.search(/\s\S*$/))), cut: true };
}

function isSecretName(name: string): boolean {
  const parts = name
    .replace(/([a-z0-9])(?=[A-Z])/g, "$1-")
    .split(/[-_.]/)
    .filter((part) => part !== "");
  const last = (parts.at(-1) ?? "").toLowerCase();
  return last === "pass" || secretSuffix.test(last);
}

function opensQuote(value: string): string | undefined {
  const quote = value.charAt(0);
  if (quote !== '"' && quote !== "'") return undefined;
  return value.length > 1 && value.endsWith(quote) ? undefined : quote;
}

function hidden(words: readonly string[]): string[] {
  const shown: string[] = [];
  let hideNext = false;
  let userNext = false;
  let openQuote: string | undefined;
  for (const word of words) {
    if (openQuote !== undefined) {
      shown.push("***");
      if (word.endsWith(openQuote)) openQuote = undefined;
      continue;
    }
    if (userNext && !word.startsWith("-")) {
      userNext = false;
      shown.push(word.replace(/^([^:]+:).+$/, "$1***"));
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
    const headerName = headerWord.exec(word);
    const header = headerName !== null && isSecretName(headerName[1] ?? "") ? headerName[0] : null;
    const flagName = flagWord.exec(word);
    userNext = userFlag.test(word);
    hideNext =
      (flagName !== null && isSecretName(flagName[1] ?? "")) ||
      (header !== null && header === word);
    const assigned = assignment.exec(word);
    const secretValue =
      assigned !== null && isSecretName(assigned[2] ?? "") ? (assigned[3] ?? "") : undefined;
    if (secretValue !== undefined) openQuote = opensQuote(secretValue);
    const attached = header !== null && header !== word ? `${header}***` : word;
    const noUser = attached
      .replace(addressUser, "$1***@")
      .replace(bareUser, "$1***@")
      .replace(userAssignment, "$1***");
    const noValue = (
      secretValue === undefined ? noUser : noUser.replace(assignment, "$1***")
    ).replace(query, (found, separator: string, name: string) =>
      isSecretName(name) ? `${separator}${name}=***` : found,
    );
    shown.push(noValue.replace(opaqueRun, "***"));
  }
  return shown;
}

export function shownCommand(raw: string, home?: string): { text: string; cut: boolean } {
  const window = windowOf(home === undefined ? raw : tildeHome(raw, home));
  const text = hidden(window.text.split(/\s+/).filter((word) => word !== "")).join(" ");
  if (text.length <= processesLimits.commandChars) return { text, cut: window.cut };
  const end = processesLimits.commandChars;
  const safeEnd = highSurrogate.test(text.charAt(end - 1)) ? end - 1 : end;
  return { text: text.slice(0, safeEnd), cut: true };
}

import { holdsHiddenText } from "../../shared/prompt-text.ts";

const plainName = /^[^\s"'`]+$/;
const fallbackName = "the base branch";

export function cleanBase(base: string | null): string {
  if (base === null || holdsHiddenText(base) || !plainName.test(base)) return fallbackName;
  return base;
}

export function conflictRequest(base: string | null): string {
  return `Update this branch from ${cleanBase(base)} and resolve the conflicts.`;
}

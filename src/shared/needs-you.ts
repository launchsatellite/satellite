import type { SessionStatus } from "./bridge-contract.ts";

export function needsYou(status: SessionStatus): boolean {
  return status === "needs-you";
}

import type { ChangeLetter } from "../../shared/bridge-contract.ts";

const conflicted = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
const letters: Partial<Record<string, ChangeLetter>> = {
  A: "A",
  M: "M",
  D: "D",
  R: "R",
  C: "C",
  T: "T",
};

export function porcelainLetter(code: string): ChangeLetter {
  if (code === "??") return "A";
  if (conflicted.has(code)) return "U";
  return letters[code.trim().charAt(0)] ?? "M";
}

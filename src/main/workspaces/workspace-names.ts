export const nameAdjectives: readonly string[] = [
  "bright",
  "calm",
  "clear",
  "crisp",
  "deep",
  "far",
  "fast",
  "keen",
  "light",
  "lunar",
  "mild",
  "near",
  "neat",
  "quick",
  "quiet",
  "rapid",
  "sharp",
  "solar",
  "steady",
  "still",
  "swift",
  "vivid",
  "warm",
  "wide",
];

export const nameNouns: readonly string[] = [
  "apex",
  "arc",
  "beam",
  "comet",
  "core",
  "dawn",
  "drift",
  "echo",
  "flare",
  "halo",
  "lander",
  "nova",
  "orbit",
  "probe",
  "pulse",
  "quasar",
  "ray",
  "relay",
  "signal",
  "spark",
  "star",
  "tide",
  "vector",
  "zenith",
];

const randomTries = 20;
const highestNumber = 99;

function pick(words: readonly string[], random: () => number): string {
  const drawn = Math.floor(random() * words.length);
  const index = Number.isFinite(drawn) ? Math.min(words.length - 1, Math.max(0, drawn)) : 0;
  return words[index] ?? "";
}

function* candidates(random: () => number): Generator<string> {
  for (let attempt = 0; attempt < randomTries; attempt += 1) {
    yield `${pick(nameAdjectives, random)}-${pick(nameNouns, random)}`;
  }
  const firstPair = `${nameAdjectives[0] ?? ""}-${nameNouns[0] ?? ""}`;
  for (let number = 2; number <= highestNumber; number += 1) yield `${firstPair}-${String(number)}`;
}

export function suggestName(
  taken: (name: string) => boolean,
  random: () => number = Math.random,
): string {
  let last = "";
  for (const candidate of candidates(random)) {
    if (!taken(candidate)) return candidate;
    last = candidate;
  }
  return last;
}

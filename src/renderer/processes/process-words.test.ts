import { describe, expect, it } from "vitest";
import { ageReadout, ageWords, countLabel, moreSentence } from "./process-words.ts";

const second = 1000;
const minute = 60 * second;
const hour = 60 * minute;
const day = 24 * hour;

describe("process words", () => {
  it("reads an age as a readout and as words", () => {
    const ages: [number, string, string][] = [
      [45 * second, "45S", "45 seconds"],
      [minute, "1M", "1 minute"],
      [12 * minute, "12M", "12 minutes"],
      [3 * hour + 5 * minute, "3H 05M", "3 hours 5 minutes"],
      [2 * day + 4 * hour, "2D 4H", "2 days 4 hours"],
      [-5 * second, "0S", "0 seconds"],
    ];
    for (const [ms, readout, words] of ages) {
      expect(ageReadout(ms)).toBe(readout);
      expect(ageWords(ms)).toBe(words);
    }
  });

  it("counts one process and many, and what is not listed", () => {
    expect(countLabel(1)).toBe("1 running process");
    expect(countLabel(3)).toBe("3 running processes");
    expect(moreSentence(1)).toBe("1 more process is not listed.");
    expect(moreSentence(7)).toBe("7 more processes are not listed.");
  });
});

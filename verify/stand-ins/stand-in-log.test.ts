import { expect, test } from "vitest";
import { writtenLines } from "./stand-in-log.ts";

test("leaves out a last line that is still being written", () => {
  expect(writtenLines('{"a":1}\n{"b":"cut')).toEqual(['{"a":1}']);
  expect(writtenLines('{"a":1}\n\n{"b":2}\n')).toEqual(['{"a":1}', '{"b":2}']);
  expect(writtenLines("")).toEqual([]);
});

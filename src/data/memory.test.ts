import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanFact, MAX_FACT_CHARS, MAX_MEMORY_LINES, memoryLines, type Fact } from "./memory";

const fact = (text: string, minutesAgo: number): Fact => ({ id: String(minutesAgo), text, source: "her", createdAt: new Date(Date.UTC(2026, 9, 6, 12) - minutesAgo * 60_000) });

test("memoryLines: newest first, whatever order the rows came in", () => {
  assert.deepEqual(memoryLines([fact("old", 30), fact("new", 1), fact("middle", 10)]), ["new", "middle", "old"]);
});

test("memoryLines: blank facts and repeats are dropped, the newest copy kept", () => {
  assert.deepEqual(memoryLines([fact("She has two kids.", 5), fact("  ", 2), fact("she has two  kids.", 1)]), ["she has two kids."]);
});

test("memoryLines: at most 40", () => {
  const many = Array.from({ length: 55 }, (_, index) => fact(`Fact ${index}`, index));
  const lines = memoryLines(many);
  assert.equal(lines.length, MAX_MEMORY_LINES);
  assert.equal(lines[0], "Fact 0");
  assert.equal(lines.at(-1), "Fact 39");
});

test("cleanFact: one line, cut to size", () => {
  assert.equal(cleanFact(" a\n b\t c "), "a b c");
  assert.equal(cleanFact("x".repeat(MAX_FACT_CHARS + 50)).length, MAX_FACT_CHARS);
});

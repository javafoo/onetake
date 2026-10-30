import assert from "node:assert/strict";
import { test } from "node:test";

import { clauses, phraseLines, sentences, wrapEvenly } from "./phrases";

const chars = (line: string) => line.length;
const QUOTE = "take the risk. worst case, you learn. best case, it changes your whole life.";

test("the founder's quote breaks at its pauses, one phrase to a line", () => {
  assert.deepEqual(phraseLines(QUOTE, chars, 22), ["take the risk.", "worst case, you learn.", "best case,", "it changes your", "whole life."]);
});

test("the lines joined are her words, untouched", () => {
  for (const width of [8, 14, 22, 40, 200]) assert.equal(phraseLines(QUOTE, chars, width).join(" "), QUOTE);
});

test("a sentence that fits stays whole, commas and all", () => {
  assert.deepEqual(phraseLines("Worst case, you learn.", chars, 30), ["Worst case, you learn."]);
});

test("her own line breaks are kept, a too-wide line wrapped evenly", () => {
  assert.deepEqual(phraseLines("take the risk\nit changes your whole life, honestly", chars, 22), ["take the risk", "it changes your", "whole life, honestly"]);
});

test("sentences keep their marks, clauses keep theirs", () => {
  assert.deepEqual(sentences("Yes! Really? Fine… ok"), ["Yes!", "Really?", "Fine…", "ok"]);
  assert.deepEqual(clauses("one thing: two; three, four — five - six"), ["one thing:", "two;", "three,", "four —", "five -", "six"]);
  assert.deepEqual(clauses("a well-known fact"), ["a well-known fact"]);
});

test("even wrapping never leaves one word alone when it can help it", () => {
  assert.deepEqual(wrapEvenly("it changes your whole life.", chars, 22), ["it changes your", "whole life."]);
  assert.deepEqual(wrapEvenly("short", chars, 22), ["short"]);
});

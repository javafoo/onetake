import assert from "node:assert/strict";
import { test } from "node:test";

import { proofProblems } from "./proof";

test("short checkable facts pass", () => {
  assert.deepEqual(proofProblems(["285,000 followers in 8 months", "0 videos filmed", "10 reels over 10 million views"]), []);
});

test("a paragraph is refused", () => {
  const [problem] = proofProblems(["I'm now at 285,000 followers. It took me 8 months. In the last month I'm still reaching 5 million views."]);
  assert.match(problem.reason, /several sentences|characters/);
});

test("money claims are refused in every common spelling", () => {
  for (const line of ["$10,000 in sales", "five figures from digital products", "made 10.5K in revenue", "six-figure year", "£2k a month income", "4 clients at 400 pounds each", "made 2k euros from one post", "300 bucks a day"]) {
    const [problem] = proofProblems([line]);
    assert.ok(problem, line);
    assert.match(problem.reason, /Money/);
  }
});

test("numbers that are not money pass", () => {
  assert.deepEqual(proofProblems(["1,000 new followers a day at peak", "80 million views in my best month", "posted 30 reels a month"]), []);
});

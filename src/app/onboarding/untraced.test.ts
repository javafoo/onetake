import assert from "node:assert/strict";
import { test } from "node:test";

import { recordAnswer, start, type InterviewState } from "@/onboarding/state";

import { untracedIn } from "./untraced";

const base = (): InterviewState =>
  start({ avatarKind: "avatar", personaName: "Nova", niche: "faceless marketing" }, "2026-01-01T00:00:00.000Z");

test("a number she typed is traced", () => {
  const state = recordAnswer(base(), "proof", { points: ["285,000 followers in 8 months"] }, "typed");
  assert.deepEqual(untracedIn(state, "I got to 285,000 in 8 months"), []);
});

test("a number the coach invented is caught", () => {
  const state = recordAnswer(base(), "proof", { points: ["155 buyers"] }, "typed");
  assert.deepEqual(untracedIn(state, "A 27 pound kit that 4000 people bought"), ["27", "4000"]);
});

test("thousands separators do not make two different numbers", () => {
  const state = recordAnswer(base(), "proof", { points: ["1,000 sales"] }, "typed");
  assert.deepEqual(untracedIn(state, "1000 sales so far"), []);
});

test("text she only tapped does not make a number hers", () => {
  const picked = recordAnswer(base(), "audience", { text: "Women with 2000 followers" }, "picked");
  assert.deepEqual(untracedIn(picked, "you have 2000 followers"), ["2000"]);
  const typed = recordAnswer(base(), "audience", { text: "Women with 2000 followers" }, "typed");
  assert.deepEqual(untracedIn(typed, "you have 2000 followers"), []);
});

test("the same invented number is only reported once", () => {
  assert.deepEqual(untracedIn(base(), "27 pounds, and another 27 pounds"), ["27"]);
});

test("a suggestion with no numbers in it is never flagged", () => {
  assert.deepEqual(untracedIn(base(), "Women who have deleted the account twice"), []);
});

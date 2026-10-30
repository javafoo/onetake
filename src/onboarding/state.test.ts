import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_PUSHBACKS, STEP_IDS } from "./steps";
import {
  isComplete,
  nextStep,
  parse,
  progress,
  pushbacksLeft,
  recordAnswer,
  recordPushback,
  serialise,
  start,
  typedMaterial,
  type InterviewState,
} from "./state";

const SETUP = { avatarKind: "avatar", personaName: "Nova", niche: "faceless marketing" } as const;
const T = "2026-09-21T10:00:00.000Z";

export function filled(state = start(SETUP, T)): InterviewState {
  let next = recordAnswer(state, "audience", { text: "Women in a 9-5 who will not show their face." }, "typed", T);
  next = recordAnswer(next, "problem", { text: "I post every day and get 200 views." }, "typed", T);
  next = recordAnswer(next, "offer", { text: "A 27 pound starter kit.", keyword: "kit" }, "typed", T);
  next = recordAnswer(
    next,
    "story",
    { before: "My account was dead.", turn: "I built an avatar.", now: "I post daily in minutes." },
    "typed",
    T,
  );
  next = recordAnswer(next, "proof", { points: ["285,000 followers in 8 months", "155 buyers"] }, "typed", T);
  next = recordAnswer(next, "pov", { text: "Everyone sells the tool and nobody teaches what to post." }, "typed", T);
  return recordAnswer(
    next,
    "voice",
    { label: "Plain and direct", caption: "Here is the thing.", is: ["short lines"], isNot: ["hype"] },
    "picked",
    T,
  );
}

test("a new interview starts on the first step with nothing answered", () => {
  const state = start(SETUP, T);
  assert.equal(state.step, "audience");
  assert.equal(nextStep(state), "audience");
  assert.equal(isComplete(state), false);
  assert.deepEqual(progress(state), { done: 0, total: STEP_IDS.length, ratio: 0, current: "audience" });
});

test("answering moves the cursor on and finishing flips the status", () => {
  const state = recordAnswer(start(SETUP, T), "audience", { text: "Shy beginners." }, "typed", T);
  assert.equal(state.step, "problem");
  assert.equal(state.status, "in_progress");
  assert.equal(progress(state).done, 1);

  const done = filled();
  assert.equal(done.status, "complete");
  assert.equal(nextStep(done), null);
  assert.equal(isComplete(done), true);
  assert.equal(progress(done).ratio, 1);
});

test("a half-finished interview survives the round trip through the database column", () => {
  const half = recordPushback(
    recordAnswer(start(SETUP, T), "audience", { text: "Shy beginners in a 9-5." }, "edited", T),
    "problem",
    T,
  );
  const resumed = parse(JSON.parse(serialise(half)));
  assert.deepEqual(resumed, half);
  assert.equal(resumed.step, "problem");
  assert.equal(nextStep(resumed), "problem");
  assert.equal(pushbacksLeft(resumed, "problem"), MAX_PUSHBACKS - 1);
  // and it can be answered straight from the resumed value
  assert.equal(recordAnswer(resumed, "problem", { text: "200 views a post." }, "typed", T).step, "offer");
});

test("re-answering an earlier step sends the cursor back to the first gap", () => {
  let state = recordAnswer(start(SETUP, T), "audience", { text: "Shy beginners." }, "typed", T);
  state = recordAnswer(state, "problem", { text: "No views." }, "typed", T);
  state = recordAnswer(state, "audience", { text: "Shy beginners in a 9-5 with a phone." }, "edited", T);
  assert.equal(state.step, "offer");
  assert.equal(state.answers.audience?.text, "Shy beginners in a 9-5 with a phone.");
});

test("pushbacks are counted per step and run out after two", () => {
  let state = start(SETUP, T);
  assert.equal(pushbacksLeft(state, "audience"), MAX_PUSHBACKS);
  state = recordPushback(state, "audience", T);
  state = recordPushback(state, "audience", T);
  assert.equal(pushbacksLeft(state, "audience"), 0);
  assert.equal(pushbacksLeft(state, "problem"), MAX_PUSHBACKS);
});

test("bad state is refused rather than half-loaded", () => {
  assert.throws(() => parse({ version: 1, setup: SETUP }));
  assert.throws(() => start({ ...SETUP, personaName: "" }));
});

test("typed material holds her own words and leaves tapped options out", () => {
  const material = typedMaterial(filled()).join("\n");
  assert.match(material, /285,000 followers/);
  assert.match(material, /faceless marketing/);
  // the voice answer was picked, not typed
  assert.doesNotMatch(material, /Here is the thing/);
});

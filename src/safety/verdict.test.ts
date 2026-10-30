import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_IDEA_CHARACTERS, refusal, verdictFromIdea, verdictFromPhoto } from "./verdict";

/* The decisions, with no model and no network. What the model is asked lives
   in the prompts; what is done with its answer lives here, and that is the
   part that has to be right when the answer is odd. */

const clean = { apparentMinor: false, nudity: false, sexual: false };
const reasonOf = (verdict: ReturnType<typeof verdictFromPhoto>) =>
  verdict.ok ? null : verdict.reason;

test("a clean photo passes", () => {
  assert.deepEqual(verdictFromPhoto(clean), { ok: true });
});

test("each category is refused, and the most serious one is what is said", () => {
  assert.equal(reasonOf(verdictFromPhoto({ ...clean, apparentMinor: true })), "apparent_minor");
  assert.equal(reasonOf(verdictFromPhoto({ ...clean, nudity: true })), "nudity");
  assert.equal(reasonOf(verdictFromPhoto({ ...clean, sexual: true })), "sexual");
  assert.equal(
    reasonOf(verdictFromPhoto({ apparentMinor: true, nudity: true, sexual: true })),
    "apparent_minor",
    "when several are true the person hears about the most serious one",
  );
});

test("an answer that is not an answer fails closed", () => {
  const notAnswers = [
    null,
    undefined,
    {},
    { apparentMinor: false },
    { apparentMinor: false, nudity: false },
    { apparentMinor: "no", nudity: false, sexual: false },
    { apparentMinor: null, nudity: false, sexual: false },
    "yes",
    42,
  ];
  for (const answer of notAnswers) {
    assert.equal(reasonOf(verdictFromPhoto(answer as never)), "check_failed", JSON.stringify(answer));
  }
});

test("a scene idea is refused for the three things the policy names", () => {
  const clean = { sexual: false, minor: false, namedRealPerson: false };
  assert.equal(verdictFromIdea(clean).ok, true);
  assert.equal(reasonOf(verdictFromIdea({ ...clean, minor: true })), "apparent_minor");
  assert.equal(reasonOf(verdictFromIdea({ ...clean, sexual: true })), "sexual");
  assert.equal(reasonOf(verdictFromIdea({ ...clean, namedRealPerson: true })), "real_person");
  assert.equal(reasonOf(verdictFromIdea({ sexual: false })), "check_failed", "a partial answer is not an answer");
  assert.equal(reasonOf(verdictFromIdea(null)), "check_failed");
});

test("the failed-check message says we will not generate without it", () => {
  const verdict = refusal("check_failed");
  const message = verdict.ok ? "" : verdict.message;
  assert.match(message, /could not run/);
  assert.match(message, /we do not generate without it/);
  assert.match(message, /Nothing was charged/);
});

test("every refusal is respectful and says nothing about what was seen", () => {
  for (const reason of ["apparent_minor", "nudity", "sexual", "real_person", "check_failed"] as const) {
    const verdict = refusal(reason);
    assert.equal(verdict.ok, false);
    const message = verdict.ok ? "" : verdict.message;
    assert.ok(message.length > 20, reason);
    // No accusation, no policy-speak, no description of the material.
    assert.doesNotMatch(message, /violat|illegal|abuse|banned|reported|explicit|porn|CSAM/i, reason);
    assert.doesNotMatch(message, /you (?:uploaded|tried|attempted|sent)/i, reason);
    // And every one of them tells the person what to do next.
    assert.match(message, /try|describe/i, reason);
  }
});

test("an idea is truncated before it is sent, so a novel is not a prompt", () => {
  assert.ok(MAX_IDEA_CHARACTERS > 200 && MAX_IDEA_CHARACTERS <= 4000);
});

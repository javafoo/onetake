import assert from "node:assert/strict";
import { test } from "node:test";

import { compile, numbersIn, SOURCE, untracedNumbers } from "./compile";
import { recordAnswer, start, type InterviewState } from "./state";

const SETUP = { avatarKind: "avatar", personaName: "Nova", niche: "faceless marketing" } as const;
const T = "2026-09-21T10:00:00.000Z";

function done(): InterviewState {
  let state = start(SETUP, T);
  state = recordAnswer(
    state,
    "audience",
    { text: "Women in a 9-5 who have wanted to post for two years and will not show their face." },
    "typed",
    T,
  );
  state = recordAnswer(
    state,
    "problem",
    { text: "I post every day and get 200 views. I have bought two courses and still do not know what to say." },
    "typed",
    T,
  );
  state = recordAnswer(state, "offer", { text: "A 27 pound starter kit with 30 reel templates.", keyword: "kit " }, "typed", T);
  state = recordAnswer(
    state,
    "story",
    {
      before: "My account was dead and I was getting nothing",
      turn: "I built an avatar so I never had to film myself",
      now: "I post twice a day and it takes minutes",
    },
    "typed",
    T,
  );
  state = recordAnswer(
    state,
    "proof",
    { points: ["285,000 followers in 8 months", "4.8M views last month", "155 people have bought something"] },
    "typed",
    T,
  );
  state = recordAnswer(
    state,
    "pov",
    { text: "Everyone in this niche sells the tool. Nobody teaches what to post with it." },
    "typed",
    T,
  );
  return recordAnswer(
    state,
    "voice",
    {
      label: "Plain and direct",
      caption: "You have wanted to start for two years.",
      is: ["short lines", "no hype"],
      isNot: ["salesy", "emoji"],
    },
    "picked",
    T,
  );
}

test("an unfinished interview will not compile", () => {
  assert.throws(() => compile(recordAnswer(start(SETUP, T), "audience", { text: "Shy beginners." }, "typed", T)), /not finished/);
});

test("compiling gives a profile and a brief the writers can read", () => {
  const { profile, brief } = compile(done(), T);

  assert.equal(profile.personaName, "Nova");
  assert.equal(profile.niche, "faceless marketing");
  assert.equal(profile.keyword, "KIT", "the keyword is one word, upper case");
  assert.equal(profile.proofPoints.length, 3);
  assert.equal(
    profile.story,
    "My account was dead and I was getting nothing. I built an avatar so I never had to film myself. I post twice a day and it takes minutes.",
  );
  assert.match(profile.voice, /Plain and direct\. Sounds like: short lines; no hype\. Never: salesy; emoji\./);

  assert.equal(
    brief.oneLiner.text,
    "Who: Women in a 9-5 who have wanted to post for two years and will not show their face. " +
      "Stuck on: I post every day and get 200 views. " +
      "Offer: A 27 pound starter kit with 30 reel templates. Comment KIT.",
  );
  assert.equal(brief.builtAt, T);
  assert.deepEqual(brief.sources, []);
  assert.deepEqual(brief.conflicts, []);
  assert.equal(brief.story.after.text, "I post twice a day and it takes minutes");
  assert.equal(brief.proof.length, 3);
  assert.ok(brief.positioningLines.length >= 2);
  const everyItem = [
    brief.oneLiner,
    ...brief.audience,
    ...brief.problem,
    ...brief.offer,
    brief.story.before,
    brief.story.turn,
    brief.story.after,
    ...brief.pointOfView,
    ...brief.voiceIs,
    ...brief.voiceIsNot,
    ...brief.proof,
    ...brief.positioningLines,
  ];
  assert.ok(everyItem.every((item) => item.source === SOURCE && item.text.length > 0));
  // the problem answer is two sentences, so it becomes two lines
  assert.equal(brief.problem.length, 2);
});

test("numbers are normalised before they are compared", () => {
  assert.deepEqual(numbersIn("285,000 followers in 8 months for 27 pounds."), ["285000", "8", "27"]);
  assert.deepEqual(numbersIn("4.8M views"), ["4.8"]);
});

test("every number in the compiled result traces back to something she typed", () => {
  const compiled = compile(done(), T);
  assert.deepEqual(untracedNumbers(done(), compiled), []);
});

test("a number the model put in her mouth fails the compile loudly", () => {
  /* She tapped this option rather than typing it, so the 3,000 in it was
     written by a model and nobody can stand behind it. */
  let state = done();
  state = recordAnswer(state, "pov", { text: "My first 3,000 followers came from one reel." }, "picked", T);
  assert.throws(() => compile(state, T), /never typed them: 3000/);

  // the same sentence, typed by her, is trusted
  const typed = recordAnswer(state, "pov", { text: "My first 3,000 followers came from one reel." }, "typed", T);
  assert.deepEqual(untracedNumbers(typed, compile(typed, T)), []);
});

test("an edited option counts as her own words", () => {
  const state = recordAnswer(done(), "pov", { text: "Nobody teaches what to post with the tool. 2 years of it." }, "edited", T);
  assert.doesNotThrow(() => compile(state, T));
});

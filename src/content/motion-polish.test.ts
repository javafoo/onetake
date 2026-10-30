import assert from "node:assert/strict";
import { test } from "node:test";

import type { generateText } from "../ai/text";

import { MOTION_RULES } from "./motion";
import { polishMotion } from "./motion-polish";

/* The polish step, with the model injected: a rewriter is not a gatekeeper.
   These check the part that holds when the model is wrong, missing or hostile. */

type Model = typeof generateText;

/** A model that always answers with the same line, and counts how often it was asked. */
function saying(motion: string) {
  const calls: { prompt: string; system?: string }[] = [];
  const model = (async (options: { prompt: string; system?: string }) => {
    calls.push({ prompt: options.prompt, system: options.system });
    return { motion } as never;
  }) as Model;
  return { model, calls };
}

test("a clean idea is reworded and the rules are appended verbatim", async () => {
  const { model, calls } = saying("She lifts the iced coffee and takes one slow sip.");
  const result = await polishMotion({ idea: "sips her coffee slowly", deps: { model } });

  assert.ok(result);
  assert.equal(result.idea, "sips her coffee slowly");
  assert.equal(result.motion, "She lifts the iced coffee and takes one slow sip.");
  assert.equal(result.prompt, `She lifts the iced coffee and takes one slow sip. ${MOTION_RULES}`);
  assert.equal(result.polished, true);
  assert.deepEqual(result.dropped, []);
  assert.equal(calls.length, 1);
});

test("the camera pan is gone before the model ever sees the idea", async () => {
  const { model, calls } = saying("She lifts one hand and slowly flips her hair back, then a small smile settles.");
  const result = await polishMotion({
    idea:
      "She looks into the camera and poses, then uses one hand to flip her hair. " +
      "she smiles at the camera, then pans it sort of above her to show off her fit at a high angle",
    deps: { model },
  });

  assert.ok(result);
  // What the model was asked to reword carries neither the pan nor the pose.
  assert.doesNotMatch(calls[0].prompt, /pans|high angle|poses/i);
  assert.equal(
    result.dropped.find((item) => item.kind === "camera")?.note,
    "The camera pan was left out: big camera moves are where faces drift.",
  );
  assert.equal(result.motion, "She lifts one hand and slowly flips her hair back, then a small smile settles.");
});

test("a rewrite that puts a camera move back is not used", async () => {
  const { model } = saying("She tucks her hair, then the camera pulls back to show the room.");
  const result = await polishMotion({ idea: "she tucks her hair behind her ear", deps: { model } });

  assert.ok(result);
  assert.equal(result.polished, false);
  // Her own surviving words, which were already legal.
  assert.equal(result.motion, "She tucks her hair behind her ear.");
  assert.doesNotMatch(result.prompt.replace(MOTION_RULES, ""), /camera/i);
});

test("a model that throws still produces a usable prompt", async () => {
  const model = (async () => {
    throw new Error("Gemini did not answer within 90s");
  }) as Model;
  const result = await polishMotion({ idea: "she glances down at her laptop then back up", deps: { model } });

  assert.ok(result);
  assert.equal(result.polished, false);
  assert.equal(result.motion, "She glances down at her laptop, then back up.");
});

test("an idea with nothing filmable in it is refused rather than invented for her", async () => {
  const { model, calls } = saying("anything at all");
  assert.equal(await polishMotion({ idea: "zoom in at a high angle", deps: { model } }), null);
  assert.equal(calls.length, 0, "no model call is worth making on an empty idea");
});

test("a rewrite that repeats the rules back is cut where the echo starts", async () => {
  const { model } = saying(
    "She lifts one hand and slowly tucks her hair behind her ear. " +
      `${MOTION_RULES} And that is the motion.`,
  );
  const result = await polishMotion({ idea: "tuck hair", deps: { model } });

  assert.ok(result);
  assert.equal(result.polished, true);
  assert.equal(result.motion, "She lifts one hand and slowly tucks her hair behind her ear.");
  // The rules appear exactly once in what the video model is sent.
  assert.equal(result.prompt.split("Handheld smartphone video").length - 1, 1);
});

test("a long answer is cut on a word, not mid-word", async () => {
  const { model } = saying(`She ${"slowly ".repeat(60)}lifts the cup and sips from it.`);
  const result = await polishMotion({ idea: "she sips her drink", deps: { model } });

  assert.ok(result);
  assert.ok(result.motion.length <= 240);
  assert.doesNotMatch(result.motion, /\s$/);
  assert.ok(result.motion.endsWith("slowly") || /[.!?]$/.test(result.motion), result.motion);
});

test("an empty or padded answer falls back rather than shipping it", async () => {
  for (const answer of ["", "ok"]) {
    const { model } = saying(answer);
    const result = await polishMotion({ idea: "she adjusts her earring", deps: { model } });
    assert.ok(result);
    assert.equal(result.polished, false);
    assert.equal(result.motion, "She adjusts her earring.");
  }
});

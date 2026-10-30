import assert from "node:assert/strict";
import { test } from "node:test";

import { creditsFor } from "@/billing/pricing";
import { DEFAULT_IMAGE_MODEL } from "@/content/image-options";

import { chooseClip, decideCue } from "./direct";
import { agentCredits, applyDirection, childRequestId, initialState, isFinished, markStep, nextStep, stepOf, type AgentRequest } from "./plan";
import { tidyScenes } from "./scenes";

const reel: AgentRequest = { kind: "reel", brief: "why an avatar beats filming yourself", footage: "auto", cue: "auto", talking: false };

test("a reel run starts with the writer and every step pending", () => {
  const state = initialState(reel);
  assert.equal(nextStep(state)?.name, "write");
  assert.ok(state.steps.every((step) => step.status === "pending"));
  assert.equal(isFinished(state), false);
});

test("steps run in order and a finished run has no next step", () => {
  let state = initialState(reel);
  const order: string[] = [];
  for (let guard = 0; guard < 10; guard++) {
    const step = nextStep(state);
    if (!step) break;
    order.push(step.name);
    state = markStep(state, step.name, "done");
  }
  assert.deepEqual(order, ["write", "direct", "photo", "clip", "reel"]);
  assert.equal(isFinished(state), true);
});

test("a library clip skips the paid photo and clip steps", () => {
  const state = applyDirection(markStep(markStep(initialState(reel), "write", "done"), "direct", "done"), {
    cue: null,
    noCueWhy: "The hook stands alone",
    clip: { mediaId: "clip_1", why: "Same car scene" },
  });
  assert.equal(state.clipMediaId, "clip_1");
  assert.equal(stepOf(state, "photo").status, "skipped");
  assert.equal(nextStep(state)?.name, "reel");
});

test("a step still waiting on a child is the next step again", () => {
  const state = markStep(markStep(initialState(reel), "write", "done"), "direct", "running");
  assert.equal(nextStep(state)?.name, "direct");
});

test("a retry carries finished steps and takes the failed one again", () => {
  const failed = markStep(markStep(markStep(initialState(reel), "write", "done", "Hook written"), "direct", "done"), "photo", "failed", "Gemini 500");
  const state = initialState(reel, { ...failed, photoMediaId: undefined, creditsSpent: 0 });
  assert.equal(stepOf(state, "write").status, "done");
  assert.equal(stepOf(state, "write").note, "Hook written");
  assert.equal(stepOf(state, "photo").status, "pending");
  assert.equal(nextStep(state)?.name, "photo");
});

test("the photo and carousel plans have their own steps", () => {
  assert.deepEqual(initialState({ kind: "photos", brief: "a cafe set", count: 3, mode: "set" }).steps.map((step) => step.name), ["plan", "photos"]);
  assert.deepEqual(initialState({ kind: "carousel", brief: "batching", format: "carousel" }).steps.map((step) => step.name), ["plan", "render"]);
});

test("a run is priced at everything it could start", () => {
  const photo = creditsFor({ kind: "image", model: DEFAULT_IMAGE_MODEL });
  const clip = creditsFor({ kind: "clip", model: "omni", seconds: 8 });
  assert.equal(agentCredits(reel), photo + clip);
  assert.ok(agentCredits({ ...reel, talking: true }) >= photo + clip, "a talking reel reserves at least a b-roll one");
  assert.ok(agentCredits({ ...reel, talking: true }) <= photo + creditsFor({ kind: "clip", model: "omni", seconds: 10 }), "and never more than the longest Omni clip");
  assert.equal(agentCredits({ kind: "photos", brief: "x", count: 4, mode: "set" }), 4 * photo);
  assert.equal(agentCredits({ kind: "photos", brief: "x", count: 99, mode: "various" }), 6 * photo);
  assert.equal(agentCredits({ kind: "carousel", brief: "x", format: "story" }), 0);
});

test("child request ids are stable per run and step", () => {
  assert.equal(childRequestId("run1", "photo"), "run1:photo:0");
  assert.equal(childRequestId("run1", "photos", 2), "run1:photos:2");
});

test("the creator's wish for the second line wins over the model", () => {
  assert.equal(decideCue("Read the caption", "It asks how", "no").cue, null);
  assert.equal(decideCue("", "", "yes").cue?.text, "Read the caption");
  const { cue } = decideCue('"Here is how I did it, read the caption now."', "why", "auto");
  assert.equal(cue?.text, "Here is how I did");
  assert.equal(decideCue("", "The hook lands on its own", "auto").noCueWhy, "The hook lands on its own");
});

test("only a real library clip can be chosen, and never when new footage was asked for", () => {
  const library = [{ mediaId: "clip_1", description: "In the car with an iced coffee" }];
  assert.equal(chooseClip("clip_1", "same scene", "auto", library)?.mediaId, "clip_1");
  assert.equal(chooseClip("made-up", "", "auto", library), null);
  assert.equal(chooseClip("clip_1", "", "new", library), null);
});

test("planned scenes are trimmed to the count with real shot types", () => {
  const scenes = tidyScenes(
    [
      { idea: "At a marble cafe table with an iced latte, glancing up", shot: "friend", why: "cafe" },
      { idea: "short", shot: "selfie", why: "" },
      { idea: "Walking a park path with a paper coffee cup in a long coat", shot: "drone" as never, why: "walk" },
      { idea: "In the driver's seat of her parked car, seatbelt on, holding an iced latte", shot: "selfie", why: "car" },
    ],
    2,
  );
  assert.equal(scenes.length, 2);
  assert.equal(scenes[1].shot, "selfie");
  assert.throws(() => tidyScenes([{ idea: "x" }], 1), /no usable scene/);
});


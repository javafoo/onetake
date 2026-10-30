import assert from "node:assert/strict";
import { test } from "node:test";

import { InvalidRequestError } from "@/lib/errors";

import { askOptions, CLIP_NOT_A_SLIDE, DEFAULT_CHOICE } from "./composer";
import { parseMaterial, withMaterial, withOptions } from "./options";
import { reelClipModel, type AgentRequest } from "./plan";

const talkingReel: AgentRequest = { kind: "reel", brief: "why I never film myself", footage: "auto", cue: "auto", talking: true };
const story: AgentRequest = { kind: "carousel", brief: "three mistakes", format: "story" };

test("a talking reel sent with the default pickers still gets the model that speaks", () => {
  const request = withOptions(talkingReel, askOptions(DEFAULT_CHOICE));
  assert.equal(request.kind === "reel" ? reelClipModel(request) : null, "omni");
});

test("a video model she picked wins over the run's choice", () => {
  const request = withOptions(talkingReel, askOptions({ ...DEFAULT_CHOICE, clipModel: "omni", clipModelPicked: true }));
  assert.equal(request.kind === "reel" ? reelClipModel(request) : null, "omni");
});

test("the format her words asked for stands unless she picked one", () => {
  const unpicked = withOptions(story, askOptions(DEFAULT_CHOICE));
  assert.equal(unpicked.kind === "carousel" ? unpicked.format : null, "story");
  const picked = withOptions(story, askOptions({ ...DEFAULT_CHOICE, format: "carousel", formatPicked: true }));
  assert.equal(picked.kind === "carousel" ? picked.format : null, "carousel");
});

test("the layout her words asked for stands unless she picked one in the Slides panel", () => {
  const split: AgentRequest = { ...story, layout: "split" };
  const unpicked = withOptions(split, askOptions(DEFAULT_CHOICE));
  assert.equal(unpicked.kind === "carousel" ? unpicked.layout : null, "split");
  const picked = withOptions(split, askOptions({ ...DEFAULT_CHOICE, layout: "grid", layoutPicked: true }));
  assert.equal(picked.kind === "carousel" ? picked.layout : null, "grid");
  // Picking photos and text clears a layout read from her words; mixed is the absence of one.
  const mixed = withOptions(split, askOptions({ ...DEFAULT_CHOICE, layout: "mixed", layoutPicked: true }));
  assert.equal(mixed.kind === "carousel" ? mixed.layout : "gone", undefined);
  // A made-up layout from a tampered request is read as the everyday one.
  const odd = withOptions(split, { ...askOptions(DEFAULT_CHOICE), layout: "collage" });
  assert.equal(odd.kind === "carousel" ? odd.layout : "gone", undefined);
});

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const C1 = "33333333-3333-4333-8333-333333333333";

test("attached ids are read as material, and anything else is refused", () => {
  assert.equal(parseMaterial(undefined), null);
  assert.equal(parseMaterial({ photos: [] }), null);
  assert.deepEqual(parseMaterial({ photos: [P1, P2, P1], clip: C1 }), { photos: [P1, P2], clip: C1 });
  assert.throws(() => parseMaterial({ photos: ["not-an-id"] }), InvalidRequestError);
  assert.throws(() => parseMaterial({ photos: Array.from({ length: 11 }, () => P1) }), InvalidRequestError);
  assert.throws(() => parseMaterial({ clip: 7 }), InvalidRequestError);
});

test("material goes where the request can use it", () => {
  const reel: AgentRequest = { kind: "reel", brief: "b", footage: "auto", cue: "auto", talking: false };
  assert.deepEqual(withMaterial(reel, { photos: [P1], clip: C1 }), { ...reel, material: { photos: [P1], clip: C1 } });
  const photos: AgentRequest = { kind: "photos", brief: "b", count: 2, mode: "set" };
  assert.deepEqual(withMaterial(photos, { photos: [P1], clip: C1 }), { ...photos, material: { photos: [P1] } });
  assert.deepEqual(withMaterial(photos, { photos: [], clip: C1 }), photos);
  assert.deepEqual(withMaterial(story, { photos: [P2, P1] }), { ...story, material: { photos: [P2, P1] } });
  assert.throws(() => withMaterial(story, { photos: [], clip: C1 }), { message: CLIP_NOT_A_SLIDE });
});

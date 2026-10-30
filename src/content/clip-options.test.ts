import assert from "node:assert/strict";
import { test } from "node:test";

import { creditsFor } from "../billing/pricing";
import { InvalidRequestError } from "../lib/errors";

import {
  CLIP_ASPECTS_COMPOSER,
  CLIP_MODELS,
  CLIP_RATIOS,
  MADE_CLIP_MODELS,
  requireMadeClipModel,
  cropFilter,
  cropSize,
  DEFAULT_CLIP_MODEL,
  DEFAULT_CLIP_RATIO,
  framingNote,
  isClipAspectRatio,
  isClipModel,
  ratiosFor,
  ratioValue,
  requireClipAspectRatio,
  requireClipModel,
  requireRatioForModel,
  type ClipAspectRatio,
} from "./clip-options";

/* The Animate drawer's two choices. Both arrive from a form, both decide what a
   clip costs or what shape it comes out, so both are checked here rather than
   trusted anywhere downstream. No network: everything in this file is pure. */

test("the drawer offers the one model on sale", () => {
  assert.deepEqual(CLIP_MODELS.map((model) => model.id), ["omni"]);
  assert.equal(DEFAULT_CLIP_MODEL, "omni");
  for (const model of CLIP_MODELS) {
    assert.ok(model.name.length > 0 && model.blurb.length > 0, `${model.id} needs a name and a line`);
  }
});

test("the price on the button is the price the pricing table charges", () => {
  // Nowhere else in the product may hard-code it.
  assert.equal(creditsFor({ kind: "clip", model: "omni", seconds: 5 }), 4);
});

test("the composer offers only the two shapes a reel is posted at", () => {
  assert.deepEqual(CLIP_ASPECTS_COMPOSER, ["9:16", "16:9"]);
  for (const shape of CLIP_ASPECTS_COMPOSER) assert.ok(isClipAspectRatio(shape));
});

test("the drawer offers four shapes, with the reel shape first and default", () => {
  assert.deepEqual(CLIP_RATIOS.map((ratio) => ratio.id), ["9:16", "3:4", "1:1", "16:9"]);
  assert.equal(DEFAULT_CLIP_RATIO, "9:16");
});

test("a missing model or shape is the default; an unknown one is refused", () => {
  for (const empty of [undefined, null, ""]) {
    assert.equal(requireClipModel(empty), "omni");
    assert.equal(requireClipAspectRatio(empty), "9:16");
  }
  assert.equal(requireClipModel("omni"), "omni");
  assert.throws(() => requireClipModel("seedance"), InvalidRequestError);
  assert.equal(requireClipAspectRatio("16:9"), "16:9");

  for (const bad of ["sora", "OMNI", "kling_std", "seedance-2.5", 7, {}, ["omni"]]) {
    assert.throws(() => requireClipModel(bad), InvalidRequestError, `model ${JSON.stringify(bad)}`);
  }
  for (const bad of ["4:5", "9:16 ", "16x9", 1, {}, ["9:16"]]) {
    assert.throws(() => requireClipAspectRatio(bad), InvalidRequestError, `ratio ${JSON.stringify(bad)}`);
  }
});

test("only the listed values pass the guards", () => {
  assert.ok(isClipModel("omni") && !isClipModel("kling_std") && !isClipModel("seedance"));
  assert.ok(!isClipModel("omni ") && !isClipModel(undefined));
  assert.ok(isClipAspectRatio("1:1") && !isClipAspectRatio("4:5"));
});

test("a ratio is width over height", () => {
  assert.equal(ratioValue("9:16"), 9 / 16);
  assert.equal(ratioValue("1:1"), 1);
  assert.equal(ratioValue("16:9"), 16 / 9);
});

/* ------------------------------------------------------------------ */
/* What the crop actually does                                         */
/* ------------------------------------------------------------------ */

test("the crop is the biggest rectangle of that shape inside the photo", () => {
  const photo = { width: 1536, height: 2048 }; // the 3:4 the photo generator makes
  const reel = cropSize(photo, "9:16");
  assert.deepEqual(reel, { width: 1152, height: 2048 });
  assert.ok(Math.abs(reel.width / reel.height - 9 / 16) < 1e-9);

  const wide = cropSize(photo, "16:9");
  assert.deepEqual(wide, { width: 1536, height: 864 });

  // A photo already of that shape is not touched.
  assert.deepEqual(cropSize({ width: 1080, height: 1920 }, "9:16"), { width: 1080, height: 1920 });
});

test("every shape crops to itself and never grows the photo", () => {
  for (const ratio of CLIP_RATIOS) {
    for (const photo of [{ width: 1536, height: 2048 }, { width: 1920, height: 1080 }, { width: 900, height: 900 }]) {
      const cropped = cropSize(photo, ratio.id);
      assert.ok(cropped.width <= photo.width + 1e-9 && cropped.height <= photo.height + 1e-9, `${ratio.id} grew the photo`);
      assert.ok(Math.abs(cropped.width / cropped.height - ratioValue(ratio.id)) < 1e-9, `${ratio.id} came out the wrong shape`);
    }
  }
});

test("the ffmpeg filter is the same arithmetic, in exact fractions", () => {
  assert.equal(cropFilter("9:16"), "crop='min(iw,ih*9/16)':'min(ih,iw*16/9)'");
  assert.equal(cropFilter("1:1"), "crop='min(iw,ih*1/1)':'min(ih,iw*1/1)'");
});

/* ------------------------------------------------------------------ */
/* What the person is told before pressing the button                  */
/* ------------------------------------------------------------------ */

test("a photo of the wrong shape says what is trimmed and from where", () => {
  /* 3:4 is the shape the photo generator makes, and it is wider than a reel:
     filling 9:16 takes a quarter of it off the sides. That is the sentence
     this whole control exists to make sure somebody reads. */
  const note = framingNote({ width: 1536, height: 2048 }, "9:16");
  assert.match(note, /wider than 9:16/);
  assert.match(note, /25% is trimmed off the left and right/);
  assert.match(note, /nothing is letterboxed/);

  // The other direction: a 3:4 photo under a landscape clip loses its top and bottom.
  const tall = framingNote({ width: 1536, height: 2048 }, "16:9");
  assert.match(tall, /taller than 16:9/);
  assert.match(tall, /the top and bottom/);
});

test("a photo already of that shape is told nothing is trimmed", () => {
  assert.match(framingNote({ width: 1080, height: 1920 }, "9:16"), /already 9:16, so nothing is trimmed/);
  // Near enough is the same shape to a viewer.
  assert.match(framingNote({ width: 1084, height: 1920 }, "9:16"), /already 9:16/);
});

test("a photo whose size we never recorded still states the rule", () => {
  for (const unknown of [null, { width: 0, height: 0 }]) {
    const note = framingNote(unknown, "1:1");
    assert.match(note, /cropped to fill 1:1/);
    assert.match(note, /nothing is letterboxed/);
  }
});

test("every shape produces a sentence, whatever the photo", () => {
  const ratios: ClipAspectRatio[] = CLIP_RATIOS.map((ratio) => ratio.id);
  for (const ratio of ratios) {
    for (const photo of [null, { width: 1536, height: 2048 }, { width: 1920, height: 1080 }]) {
      assert.ok(framingNote(photo, ratio).endsWith("."), `${ratio} did not produce a sentence`);
    }
  }
});

/* Omni takes an aspect ratio and knows two; a shape it cannot make is refused
   before the clip is charged, and the drawer does not offer it. */
test("Omni makes 9:16 and 16:9 only", () => {
  assert.deepEqual(ratiosFor("omni"), ["9:16", "16:9"]);
  assert.throws(() => requireRatioForModel("omni", "1:1"), /9:16 or 16:9/);
  assert.doesNotThrow(() => requireRatioForModel("omni", "16:9"));
});

/* The job's list is every model that is priced, and the drawer offers no model the job cannot make. */
test("the job makes every priced model", () => {
  for (const model of MADE_CLIP_MODELS) {
    assert.equal(requireMadeClipModel(model), model);
    assert.ok(creditsFor({ kind: "clip", model, seconds: 5 }) > 0);
  }
  assert.throws(() => requireMadeClipModel("seedance_25"), InvalidRequestError);
  assert.throws(() => requireMadeClipModel("sora"), InvalidRequestError);
  for (const option of CLIP_MODELS) assert.ok(MADE_CLIP_MODELS.includes(option.id));
});

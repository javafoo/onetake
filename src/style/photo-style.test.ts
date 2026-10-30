import assert from "node:assert/strict";
import { test } from "node:test";

import { SHOT_LABEL } from "./shot-types";
import { asksForSelfie, isPhotoStyle, PHOTO_STYLES, photoStyleOf, SHOT_LABEL_BY_STYLE } from "./photo-style";

test("no style, no lock and unknown values are the everyday style", () => {
  assert.equal(photoStyleOf(null), "everyday");
  assert.equal(photoStyleOf({}), "everyday");
  assert.equal(photoStyleOf({ photoStyle: "cinematic" }), "everyday");
  assert.equal(photoStyleOf({ photoStyle: "editorial" }), "editorial");
});

test("only the two known styles are accepted from a form", () => {
  assert.deepEqual([...PHOTO_STYLES], ["everyday", "editorial"]);
  assert.equal(isPhotoStyle("editorial"), true);
  assert.equal(isPhotoStyle("EDITORIAL"), false);
  assert.equal(isPhotoStyle(undefined), false);
});

test("the everyday shot labels are the ones the app always showed", () => {
  assert.deepEqual(SHOT_LABEL_BY_STYLE.everyday, SHOT_LABEL);
});

test("every shot type has a label in both styles", () => {
  for (const style of PHOTO_STYLES) {
    assert.deepEqual(Object.keys(SHOT_LABEL_BY_STYLE[style]).sort(), Object.keys(SHOT_LABEL).sort());
  }
});

test("an idea that says selfie asks for one", () => {
  assert.equal(asksForSelfie("In a modern hallway, she takes a low-angle selfie looking slightly upward"), true);
  assert.equal(asksForSelfie("Mirror selfie in a cream bedroom"), true);
  assert.equal(asksForSelfie("Selfies on the sofa"), true);
});

test("an idea with no selfie in it does not", () => {
  assert.equal(asksForSelfie("Seated on a cream sofa in a navy blazer, soft window light"), false);
  assert.equal(asksForSelfie("Holding a phone, looking at the screen"), false);
});

test("an idea that rules the selfie or the phone out is not a selfie", () => {
  assert.equal(asksForSelfie("a portrait, not a selfie, in a hallway"), false);
  assert.equal(asksForSelfie("no selfie, a photographer took it"), false);
  assert.equal(asksForSelfie("a low-angle selfie without a phone in frame"), false);
  assert.equal(asksForSelfie("instead of a selfie, a seated portrait"), false);
});

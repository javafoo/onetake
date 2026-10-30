import assert from "node:assert/strict";
import { test } from "node:test";

import { CHARACTER_REFS, JUDGE_REFS, lookedPrompt, referencedPrompt, sourcedPrompt, swapPrompt, trimReferences } from "./scene";

/* The pure parts of a photo: which references go with it and the sentences
   that tell the model what the attached images are. The model calls are not
   here; they are what the prompt is for. */

test("every photo prompt binds the attached photos to the woman in the caption", () => {
  const one = referencedPrompt("P", 1);
  assert.ok(one.startsWith("P\n\n"), "the caption comes first, untouched");
  assert.match(one, /Image 1 is a reference photo of the woman in this picture/);
  assert.match(one, /keep her face exactly as it is in those photos/);
  assert.match(one, /the photos win/);
  assert.match(referencedPrompt("P", 4), /Images 1 to 4 are reference photos/);
});

test("the references are cut to what the model honours, after what she attached", () => {
  const five = ["front", "three_quarter", "profile", "full_body", "expression"];
  assert.deepEqual(trimReferences(five, "daily", 0), five.slice(0, 4), "Nano Banana 2 holds four people");
  assert.deepEqual(trimReferences(five, "pro", 0), five, "Pro holds five");
  assert.deepEqual(trimReferences(five, "daily", 3), ["front"], "three attached photos leave one slot");
  // Attached photos never push out the front reference, whatever the count.
  assert.deepEqual(trimReferences(five, "daily", 4), ["front"]);
  assert.deepEqual(trimReferences(["front"], "pro", 0), ["front"]);
  assert.ok(JUDGE_REFS <= Math.min(...Object.values(CHARACTER_REFS)), "the judge never sees a reference the model did not");
});

test("the attached-photo instruction counts on from the references that were kept", () => {
  const prompt = sourcedPrompt(referencedPrompt("P", 1), "same outfit", 1, 3);
  assert.match(prompt, /Image 1 is a reference photo/);
  assert.match(prompt, /Images 2 to 4 are an earlier photo/);
  assert.match(prompt, /first 1 images/);
});

test("a picture to recreate is copied for its shot and never for its person", () => {
  assert.equal(lookedPrompt("P", "wavy hair", 3, 0), "P");
  const prompt = lookedPrompt("P", "wavy loose hair", 3, 1);
  assert.match(prompt, /Image 4 is a picture she wants recreated, of a different person/);
  assert.match(prompt, /pose and hand placement/);
  assert.match(prompt, /how sharp or soft the focus is/);
  assert.match(prompt, /face, skin, age, body, hair and styling come from the reference photos of her and her wardrobe/);
  assert.match(prompt, /the instruction wins: wavy loose hair\./);
});

test("a swap names image 1 as the picture and her photos after it, and describes nothing", () => {
  const prompt = swapPrompt("wavy loose hair", 3);
  assert.match(prompt, /^Edit image 1\. Keep it exactly as it is/);
  assert.match(prompt, /woman in images 2 to 4/);
  assert.match(prompt, /Nothing of the original person's face, skin or age stays/);
  assert.match(prompt, /wavy loose hair/);
  assert.match(swapPrompt("x", 1), /woman in image 2: keep her face exactly as it is in that photo/);
});

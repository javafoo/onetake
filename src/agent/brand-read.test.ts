import assert from "node:assert/strict";
import { test } from "node:test";

import { brandForMessage, brandOffInMessage } from "./brand-read";
import { askOptions, brandChipLabel, choiceMemory, DEFAULT_CHOICE, rememberedChoice } from "./composer";

test("her words turn the brand off", () => {
  for (const message of [
    "A winter arc carousel, not about my brand",
    "make a reel unrelated to my brand, just a storyline",
    "Something just for fun: my cat judging my outfit",
    "write it from scratch",
    "a carousel that has nothing to do with my business",
    "a winter arc post without my brand",
    "Not related to my offer please",
  ]) {
    assert.equal(brandOffInMessage(message), true, message);
  }
});

test("everyday words leave the brand on", () => {
  for (const message of [
    "a carousel about my brand story",
    "a reel about building a brand people trust",
    "make it fun",
    "a photo without the product in it",
    "how I got my business off the ground",
    "scratching the surface of AI avatars",
  ]) {
    assert.equal(brandOffInMessage(message), false, message);
  }
});

test("the chip wins when she set it; otherwise her words decide", () => {
  assert.equal(brandForMessage(undefined, "just for fun"), false);
  assert.equal(brandForMessage(true, "just for fun"), true);
  assert.equal(brandForMessage(false, "a reel about my offer"), false);
  assert.equal(brandForMessage(undefined, "a reel about my offer"), true);
  assert.equal(brandForMessage("off", "a reel"), true, "only a real boolean counts");
});

test("the Brand chip: on by default, sent and remembered only once she sets it", () => {
  assert.equal(DEFAULT_CHOICE.brand, true);
  assert.equal("brand" in askOptions(DEFAULT_CHOICE), false);
  const off = { ...DEFAULT_CHOICE, brand: false, brandPicked: true };
  assert.equal(askOptions(off).brand, false);
  const back = rememberedChoice(choiceMemory(off), DEFAULT_CHOICE);
  assert.equal(back.brand, false);
  assert.equal(back.brandPicked, true);
  assert.equal(rememberedChoice(choiceMemory(DEFAULT_CHOICE), DEFAULT_CHOICE).brandPicked, false);
  assert.equal(rememberedChoice(JSON.stringify({ brand: "no" }), DEFAULT_CHOICE).brand, true);
  assert.equal(brandChipLabel(true), "Brand on");
  assert.equal(brandChipLabel(false), "Brand off");
});

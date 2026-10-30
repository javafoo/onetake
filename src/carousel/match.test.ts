import assert from "node:assert/strict";
import { test } from "node:test";

import { applyPhotos, layoutTakesScenes, photoSlots, photoSubject, settlePicks, type Candidate } from "./match";
import { autoPickPhotos, photoPool, type PhotoCandidate } from "./pick";
import { parseSpec, slidePhotos, type CarouselSpec } from "./spec";

/* Placing photos behind lines. Pure: descriptions and picks in, a spec out. */

const grid: CarouselSpec = parseSpec({
  name: "to-dos",
  caption: "Comment CLAUDE",
  layout: "grid",
  slides: [
    { type: "grid", photos: ["p00", "p00", "p00", "p00"], headline: "To Do's", sub: "before the year ends" },
    { type: "line", photo: "p00", text: "restart a hobby you forgot you had" },
    { type: "line", photo: "p00", text: "check your finances for the year" },
    { type: "line", photo: "p00", text: "drink more water" },
    { type: "keyword", keyword: "CLAUDE", promise: "for the whole list", photo: "p00" },
  ],
});

const split: CarouselSpec = parseSpec({
  name: "swaps",
  caption: "Comment CLAUDE",
  layout: "split",
  slides: [
    { type: "split", photos: ["p00", "p01"], lines: ["can't gym?", "walk for 10 min"] },
    { type: "split", photos: ["p00", "p01"], lines: ["no time?", "one photo"] },
    { type: "split", photos: ["p00", "p01"], lines: ["a", "b"] },
    { type: "split", photos: ["p00", "p01"], lines: ["c", "d"] },
    { type: "keyword", keyword: "CLAUDE", promise: "the guide", photo: "p00" },
  ],
});

const photo = (id: string, subject: Candidate["subject"] = "scene"): Candidate => ({ id, subject, description: id });

test("a photo is her unless it was marked a scene", () => {
  assert.equal(photoSubject({ subject: "scene" }), "scene");
  assert.equal(photoSubject({ subject: "me" }), "me");
  assert.equal(photoSubject({}), "me");
  assert.equal(photoSubject(null), "me");
  assert.ok(layoutTakesScenes("split") && layoutTakesScenes("grid"));
  assert.ok(!layoutTakesScenes("mixed") && !layoutTakesScenes("photos"));
});

test("every photo slot is listed in reading order, each half of a split with its own line", () => {
  const slots = photoSlots(split);
  assert.equal(slots.length, 9);
  assert.deepEqual(slots.slice(0, 2), [
    { slide: 0, slot: 0, text: "can't gym?" },
    { slide: 0, slot: 1, text: "walk for 10 min" },
  ]);
  assert.equal(photoSlots(grid).length, 4 + 3 + 1);
});

test("good picks are kept; bad ones and early repeats are filled from unused photos", () => {
  const slots = photoSlots(split).slice(0, 4);
  const candidates = [photo("gym", "me"), photo("street"), photo("desk"), photo("coffee")];
  // Slot 2 repeats photo 0 while two are unused; slot 3 is out of range.
  assert.deepEqual(settlePicks(slots, candidates, [0, 1, 0, 9]), ["gym", "street", "desk", "coffee"]);
});

test("once every photo is used, repeats spread across the set rather than piling on one", () => {
  const slots = photoSlots(split); // nine slots
  const candidates = [photo("a", "me"), photo("b"), photo("c")];
  const settled = settlePicks(slots, candidates, []);
  const counts = settled.reduce<Record<string, number>>((all, id) => ({ ...all, [id]: (all[id] ?? 0) + 1 }), {});
  assert.deepEqual(counts, { a: 3, b: 3, c: 3 });
});

test("a grid cover of four scenes gets one photo of her when she has one", () => {
  const slots = photoSlots(grid);
  const candidates = [photo("desk"), photo("easel"), photo("closet"), photo("coffee"), photo("her", "me"), photo("water"), photo("laptop"), photo("view")];
  const settled = settlePicks(slots, candidates, [0, 1, 2, 3, 4, 5, 6, 7], grid);
  assert.equal(settled[0], "her");
  // The slot she was taken from gets the cover photo she replaced, so nothing is lost.
  assert.equal(settled[4], "desk");
});

test("the matched photos become refs on the spec and a map to store with it", () => {
  const slots = photoSlots(grid);
  const ids = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m1"];
  const { spec, photos } = applyPhotos(grid, slots, ids);
  assert.deepEqual(slidePhotos(spec.slides[0]), ["p00", "p01", "p02", "p03"]);
  assert.deepEqual(slidePhotos(spec.slides[4]), ["p00"]);
  assert.equal(photos.p00, "m1");
  assert.equal(Object.keys(photos).length, 7);
  assert.doesNotThrow(() => parseSpec(spec));
});

test("scene photos are picked only for the layouts that take them", () => {
  const candidates: PhotoCandidate[] = [
    { id: "desk", kind: "image", createdAt: 3, subject: "scene" },
    { id: "her", kind: "image", createdAt: 2 },
    { id: "ref", kind: "reference", createdAt: 1 },
  ];
  assert.deepEqual(autoPickPhotos(candidates, 5, "mixed"), ["her", "ref"]);
  assert.deepEqual(autoPickPhotos(candidates, 5, "grid"), ["desk", "her", "ref"]);
});

test("a split or grid set offers the matcher more photos than it needs", () => {
  assert.equal(photoPool("carousel", "split"), 24);
  assert.equal(photoPool("carousel", "grid"), 20);
  assert.equal(photoPool("carousel", "mixed"), 3);
});

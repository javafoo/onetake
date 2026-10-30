import assert from "node:assert/strict";
import { test } from "node:test";

import { createCanvas, loadImage } from "@napi-rs/canvas";

import type { BrandProfile } from "../content/hooks";
import { resolveKit } from "./kits";
import { photosNeeded } from "./pick";
import { keywordAsCover, renderSpec } from "./render";
import { parseSpec, slidePhotos, specProblems, type CarouselSpec } from "./spec";
import { toSpec, type Draft } from "./write";

/* The all-photo set: every slide on a photo, the keyword slide included. No
   network: the draft stands in for what the writer would return. */

const profile: BrandProfile = {
  personaName: "Maya",
  story: "",
  niche: "Content with an AI avatar",
  audience: "Women who will not show their face",
  offer: "A beginner guide",
  keyword: "CLAUDE",
  voice: "Plain and warm",
  proofPoints: [],
};

const draft: Draft = {
  caption: "Comment CLAUDE for the full system.",
  slides: [
    { type: "cover", titleLines: ["I hate being", "on camera"], sub: "So I sent one selfie and asked for a month of posts." },
    { type: "paper", titleLines: ["One selfie"], body: "From one photo I can make as much content as I need." },
    { type: "cover", titleLines: ["Done for", "the month"], sub: "Without filming a thing." },
    { type: "paper", titleLines: ["Here is how"], body: "The whole system is on the next slide." },
    { type: "keyword", keyword: "CLAUDE", promise: "I will send you the full system." },
  ],
};

const options = { profile, name: "photo-set", format: "carousel" as const, photoRefs: ["p00", "p01"] };

test("a set saved before layouts existed reads as mixed", () => {
  const parsed = parseSpec({
    name: "old-set",
    caption: "one line",
    slides: [
      { type: "cover", photo: "p00", title: { lines: ["a"] } },
      { type: "paper", title: { lines: ["b"] }, body: "a sentence" },
      { type: "paper", title: { lines: ["c"] }, body: "a sentence" },
      { type: "paper", title: { lines: ["d"] }, body: "a sentence" },
      { type: "keyword", keyword: "CLAUDE", promise: "the guide" },
    ],
  });
  assert.equal(parsed.layout, "mixed");
});

test("an all-photo set refuses a paper slide and a keyword slide with no photo", () => {
  const problems = specProblems({
    name: "photo-set",
    caption: "one line",
    layout: "photos",
    slides: [
      { type: "cover", photo: "p00", title: { lines: ["a"] } },
      { type: "paper", title: { lines: ["b"] }, body: "a sentence" },
      { type: "cover", photo: "p00", title: { lines: ["c"] } },
      { type: "cover", photo: "p00", title: { lines: ["d"] } },
      { type: "keyword", keyword: "CLAUDE", promise: "the guide" },
    ],
  });
  assert.ok(problems.some((problem) => problem.includes("no paper slides")));
  assert.ok(problems.some((problem) => problem.includes("keyword slide has a photo")));
});

test("in an all-photo set every slide gets a photo, and a paper slide the writer wrote anyway moves onto one", () => {
  const spec = parseSpec(toSpec(draft, { ...options, layout: "photos" }));
  assert.equal(spec.layout, "photos");
  assert.ok(spec.slides.every((slide) => slide.type !== "paper"));
  const second = spec.slides[1];
  assert.equal(second.type, "cover");
  if (second.type === "cover") assert.equal(second.sub, "From one photo I can make as much content as I need.");
  const last = spec.slides[4];
  assert.equal(last.type, "keyword");
  if (last.type === "keyword") assert.ok(last.photo);
});

test("with fewer photos than slides the photos repeat, in order", () => {
  const spec = parseSpec(toSpec(draft, { ...options, layout: "photos" }));
  const refs = spec.slides.map((slide) => slidePhotos(slide)[0] ?? null);
  assert.deepEqual(refs, ["p00", "p01", "p00", "p01", "p00"]);
});

test("a mixed set is written as before: paper stays paper and the keyword slide has no photo", () => {
  const spec = parseSpec(toSpec(draft, options));
  assert.equal(spec.layout, "mixed");
  assert.deepEqual(
    spec.slides.map((slide) => slide.type),
    ["cover", "paper", "cover", "paper", "keyword"],
  );
  const last = spec.slides[4];
  if (last.type === "keyword") assert.equal(last.photo, undefined);
});

test("an all-photo set asks for a photo per slide; a mixed one for its covers", () => {
  assert.equal(photosNeeded("carousel"), 3);
  assert.equal(photosNeeded("story"), 2);
  assert.equal(photosNeeded("carousel", "photos"), 8);
  assert.equal(photosNeeded("story", "photos"), 5);
});

test("the keyword slide becomes one more caption: the word set apart, the promise underneath", () => {
  const cover = keywordAsCover({ type: "keyword", keyword: "CLAUDE", promise: "I will send you the full system." }, "p03");
  assert.deepEqual(cover, {
    type: "cover",
    photo: "p03",
    title: { lines: ["Comment *CLAUDE*"] },
    sub: "I will send you the full system.",
  });
});

/** A flat colour stands in for a photo: whatever shows at the corner is the photo, or it is not. */
function flatPhoto(): Buffer {
  const canvas = createCanvas(900, 1200);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#3366cc";
  ctx.fillRect(0, 0, 900, 1200);
  return canvas.toBuffer("image/png");
}

async function cornerOf(png: Buffer): Promise<[number, number, number]> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const [r, g, b] = ctx.getImageData(8, 8, 1, 1).data;
  return [r, g, b];
}

test("in the Standard look the last slide of an all-photo set is the photo as it is, not the dark keyword poster", async () => {
  const kit = resolveKit("boxed");
  const photos = { p00: { data: flatPhoto() }, p01: { data: flatPhoto() } };
  const spec: CarouselSpec = parseSpec(toSpec(draft, { ...options, layout: "photos" }));
  const rendered = await renderSpec(spec, kit, photos);
  assert.equal(rendered.slides.length, 5);
  for (const slide of rendered.slides) assert.deepEqual(await cornerOf(slide.png), [0x33, 0x66, 0xcc]);
});

test("her attached photos are each used once, and a cover past the last one is drawn on paper", () => {
  const spec = parseSpec(toSpec(draft, { ...options, photoRefs: ["p00"], photosOnce: true }));
  assert.deepEqual(
    spec.slides.map((slide) => slide.type),
    ["cover", "paper", "paper", "paper", "keyword"],
  );
  const third = spec.slides[2];
  if (third.type === "paper") assert.equal(third.body, "Without filming a thing.");
  const both = parseSpec(toSpec(draft, { ...options, photosOnce: true }));
  assert.deepEqual(both.slides.map((slide) => (slide.type === "cover" ? slide.photo : null)), ["p00", null, "p01", null, null]);
});

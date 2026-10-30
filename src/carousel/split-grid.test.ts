import assert from "node:assert/strict";
import { test } from "node:test";

import { createCanvas, loadImage } from "@napi-rs/canvas";

import type { BrandProfile } from "../content/hooks";
import { checkSpec } from "./check";
import { editSlide, setSlidePhoto } from "./edit";
import { resolveKit } from "./kits";
import { photosNeeded } from "./pick";
import { balancedLines, layoutWrapped, renderSpec, wrapUnits } from "./render";
import { layoutFrom, parseSpec, slidePhotos, specProblems } from "./spec";
import { toSpec, withCoverTitle, type Draft } from "./write";

/* The half-and-half and four-photo-cover sets. No network: the drafts stand in
   for what the writer would return, and flat colours stand in for photos. */

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

const refs = ["p00", "p01", "p02", "p03", "p04", "p05", "p06", "p07", "p08"];
const options = { profile, name: "layout-set", format: "carousel" as const, photoRefs: refs };

const splitDraft: Draft = {
  caption: "Comment CLAUDE for the full system.",
  slides: [
    { type: "split", titleLines: ["can't film yourself?", "send one selfie"] },
    { type: "split", titleLines: ["no time to post", "batch a month in an hour"] },
    { type: "split", titleLines: ["the post you almost deleted", "is the one that grows you"] },
    { type: "split", titleLines: ["hate your voice?", "let the captions talk"] },
    { type: "keyword", keyword: "CLAUDE", promise: "and I will send you the full system" },
  ],
};

const gridDraft: Draft = {
  caption: "Comment CLAUDE for the whole list.",
  slides: [
    { type: "grid", titleLines: ["To Do's"], sub: "before the year ends" },
    { type: "line", body: "make your desktop look like the future you want" },
    { type: "line", body: "restart a hobby you forgot you had" },
    { type: "line", body: "check your finances for the year" },
    { type: "keyword", keyword: "CLAUDE", promise: "for the whole list" },
  ],
};

test("a split draft becomes split slides with two photos each and a keyword slide on a photo", () => {
  const spec = parseSpec(toSpec(splitDraft, { ...options, layout: "split" }));
  assert.equal(spec.layout, "split");
  assert.deepEqual(spec.slides[0], { type: "split", photos: ["p00", "p01"], lines: ["can't film yourself?", "send one selfie"] });
  assert.deepEqual(slidePhotos(spec.slides[1]), ["p02", "p03"]);
  const last = spec.slides[spec.slides.length - 1];
  assert.equal(last.type, "keyword");
  assert.deepEqual(slidePhotos(last), ["p08"]);
  assert.deepEqual(checkSpec(spec, { profile }), []);
});

test("a split slide the model wrote as a cover is still drawn as a split, its sub as the bottom line", () => {
  const draft: Draft = {
    ...splitDraft,
    slides: [{ type: "cover", titleLines: ["can't gym?"], sub: "walk for 10 min" }, ...(splitDraft.slides ?? []).slice(1)],
  };
  const spec = parseSpec(toSpec(draft, { ...options, layout: "split" }));
  assert.deepEqual(spec.slides[0], { type: "split", photos: ["p00", "p01"], lines: ["can't gym?", "walk for 10 min"] });
});

test("a grid draft opens on four photos and follows with one photo and one line a slide", () => {
  const spec = parseSpec(toSpec(gridDraft, { ...options, layout: "grid" }));
  assert.deepEqual(spec.slides[0], { type: "grid", photos: ["p00", "p01", "p02", "p03"], headline: "To Do's", sub: "before the year ends" });
  assert.deepEqual(spec.slides[1], { type: "line", photo: "p04", text: "make your desktop look like the future you want" });
  assert.deepEqual(checkSpec(spec, { profile }), []);
});

test("each layout refuses the slide types that belong to another", () => {
  const base = { name: "wrong-set", caption: "one line" };
  const keyword = { type: "keyword", keyword: "CLAUDE", promise: "the guide", photo: "p00" };
  const split = { type: "split", photos: ["p00", "p01"], lines: ["a", "b"] };
  const line = { type: "line", photo: "p00", text: "a line" };
  const cover = { type: "cover", photo: "p00", title: { lines: ["a"] } };

  assert.ok(specProblems({ ...base, layout: "split", slides: [split, split, line, split, keyword] }).some((p) => p.includes("no line slides")));
  assert.ok(specProblems({ ...base, layout: "grid", slides: [cover, line, line, line, keyword] }).some((p) => p.includes("first slide")));
  assert.ok(specProblems({ ...base, layout: "mixed", slides: [cover, split, split, split, keyword] }).some((p) => p.includes("no split slides")));
  assert.ok(specProblems({ ...base, layout: "split", slides: [split, split, split, split, { ...keyword, photo: undefined }] }).some((p) => p.includes("keyword slide has a photo")));
  assert.deepEqual(specProblems({ ...base, layout: "split", slides: [split, split, split, split, keyword] }), []);
});

test("a split set may open on a four-photo cover", () => {
  const grid = { type: "grid", photos: ["p00", "p01", "p02", "p03"], headline: "Swaps" };
  const split = { type: "split", photos: ["p00", "p01"], lines: ["a", "b"] };
  const keyword = { type: "keyword", keyword: "CLAUDE", promise: "the guide", photo: "p00" };
  assert.deepEqual(specProblems({ name: "swaps", caption: "one line", layout: "split", slides: [grid, split, split, split, keyword] }), []);
});

test("lines too long to read over a photo fail the checks", () => {
  const spec = parseSpec(toSpec(splitDraft, { ...options, layout: "split" }));
  const long = editSlide(spec, 1, { bottom: "batch a whole month of posts in one single hour" });
  assert.deepEqual(checkSpec(long, { profile }).map((problem) => [problem.slide, problem.rule]), [[2, "photo-line-length"]]);

  const grid = parseSpec(toSpec(gridDraft, { ...options, layout: "grid" }));
  const longTitle = editSlide(grid, 0, { headline: "Everything to do before the year ends" });
  assert.deepEqual(checkSpec(longTitle, { profile }).map((problem) => problem.rule), ["grid-title-length"]);
  // Her own cover words are hers, at any length.
  assert.deepEqual(checkSpec(longTitle, { profile, fixedCover: true }), []);
});

test("editing a split slide changes one half and keeps the other", () => {
  const spec = parseSpec(toSpec(splitDraft, { ...options, layout: "split" }));
  const edited = editSlide(spec, 0, { bottom: "send one photo" });
  const slide = edited.slides[0];
  assert.equal(slide.type, "split");
  if (slide.type === "split") assert.deepEqual(slide.lines, ["can't film yourself?", "send one photo"]);
  assert.throws(() => editSlide(spec, 0, { top: "  " }), /top photo needs its line/);
});

test("a photo swap replaces only the slot it names", () => {
  const spec = parseSpec(toSpec(gridDraft, { ...options, layout: "grid" }));
  const swapped = setSlidePhoto(spec, 0, "s00-2", 2);
  assert.deepEqual(slidePhotos(swapped.slides[0]), ["p00", "p01", "s00-2", "p03"]);
  assert.throws(() => setSlidePhoto(spec, 0, "s00-4", 4), /not on this slide/);
  assert.throws(() => setSlidePhoto(spec, 1, "s01-1", 1), /not on this slide/);
});

test("her cover words go on the grid title and the line under it", () => {
  const spec = parseSpec(toSpec(gridDraft, { ...options, layout: "grid" }));
  const first = withCoverTitle(spec, "To Do's. Before 2027 ends").slides[0];
  assert.equal(first.type, "grid");
  if (first.type === "grid") {
    assert.equal(first.headline, "To Do's");
    assert.equal(first.sub, "Before 2027 ends");
  }
});

test("a split set asks for two photos a slide and a grid set for four on the cover", () => {
  assert.equal(photosNeeded("carousel", "split"), 15);
  assert.equal(photosNeeded("carousel", "grid"), 11);
  assert.equal(photosNeeded("story", "split"), 7);
});

test("layouts from a form or an old job fall back to mixed", () => {
  assert.equal(layoutFrom("split"), "split");
  assert.equal(layoutFrom("grid"), "grid");
  assert.equal(layoutFrom("anything"), "mixed");
  assert.equal(layoutFrom(undefined), "mixed");
});

/* --- what the renderer draws ---------------------------------------------- */

function flat(color: string): Buffer {
  const canvas = createCanvas(900, 1200);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 900, 1200);
  return canvas.toBuffer("image/png");
}

async function pixel(png: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
  return [r, g, b];
}

const RED = [0xcc, 0x33, 0x33] as const;
const BLUE = [0x33, 0x66, 0xcc] as const;
const GREEN = [0x33, 0xaa, 0x55] as const;
const GOLD = [0xdd, 0xaa, 0x22] as const;
const hex = (rgb: readonly number[]) => `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;

test("a split slide draws its first photo on the top half and its second on the bottom", async () => {
  const spec = parseSpec(toSpec(splitDraft, { ...options, layout: "split" }));
  const photos = Object.fromEntries(refs.map((ref, index) => [ref, { data: flat(hex(index % 2 ? BLUE : RED)) }]));
  const rendered = await renderSpec(spec, resolveKit("signal"), photos);
  const first = rendered.slides[0].png;
  assert.deepEqual(await pixel(first, 8, 8), [...RED]);
  assert.deepEqual(await pixel(first, 8, 1350 - 8), [...BLUE]);
});

test("a grid slide draws its four photos in reading order", async () => {
  const spec = parseSpec(toSpec(gridDraft, { ...options, layout: "grid" }));
  const colours = [RED, BLUE, GREEN, GOLD];
  const photos = Object.fromEntries(refs.map((ref, index) => [ref, { data: flat(hex(colours[index % 4])) }]));
  const rendered = await renderSpec(spec, resolveKit("atelier"), photos);
  const cover = rendered.slides[0].png;
  assert.deepEqual(await pixel(cover, 8, 8), [...RED]);
  assert.deepEqual(await pixel(cover, 1080 - 8, 8), [...BLUE]);
  assert.deepEqual(await pixel(cover, 8, 1350 - 8), [...GREEN]);
  assert.deepEqual(await pixel(cover, 1080 - 8, 1350 - 8), [...GOLD]);
  assert.equal(rendered.slides.length, 5);
});

test("a grid title wraps into even lines and never splits a marked word", () => {
  const measure = (line: string) => line.replace(/\*/g, "").length * 10;
  assert.deepEqual(balancedLines("hobbies that will quietly rewire your brain", measure, 250), ["hobbies that will quietly", "rewire your brain"]);
  assert.deepEqual(balancedLines("To Do's", measure, 250), ["To Do's"]);
  assert.deepEqual(wrapUnits("*rewire your* brain:"), ["*rewire your*", "brain:"]);
});

test("a grid title is set at one size: a short one is not enlarged and a long one wraps instead of shrinking", () => {
  const kit = resolveKit("bold");
  const short = layoutWrapped(kit, "To Do's", { size: 92, maxWidth: 912, maxLines: 3 });
  const long = layoutWrapped(kit, "hobbies that will quietly rewire your brain", { size: 92, maxWidth: 912, maxLines: 3 });
  assert.equal(short.size, 92);
  assert.equal(long.size, 92);
  assert.ok(long.lines.length > 1);
});

test("her own cover words split at her line break: the big line, then the small one with its marked word", () => {
  const spec = parseSpec(toSpec(gridDraft, { ...options, layout: "grid" }));
  const first = withCoverTitle(spec, "hobbies that will\n*rewire* your brain:").slides[0];
  assert.equal(first.type, "grid");
  if (first.type === "grid") {
    assert.equal(first.headline, "hobbies that will");
    assert.equal(first.sub, "*rewire* your brain:");
  }
});

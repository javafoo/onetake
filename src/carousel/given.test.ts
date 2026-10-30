import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { withKeyword } from "../content/offers";
import { writerProfile } from "../content/brand-scope";
import type { BrandProfile } from "../content/hooks";
import { checkSpec } from "./check";
import { givenCaption, givenSpec, givenTitleLines } from "./given";
import { carouselSpecSchema, slideText, type CarouselSpec } from "./spec";

/* Her own slides, drawn without a writer: every word of hers on the slide it
   was written for, in her order, and nothing after her last one. */

const SLIDES = [
  "How a post turns into a sale",
  "Someone stops on your reel.",
  "They read the caption and see the offer. That is where it starts.",
  "They comment the keyword.",
  "You send the guide in their DMs.",
  "The guide shows them the next step.",
  "Comment CASH and I'll send it to you.",
];

const profile: BrandProfile = { niche: "avatars", audience: "shy creators", offer: "a guide", keyword: "AVATAR", voice: "plain", proofPoints: [] };
const base = { name: "her-set", format: "carousel" as const, photoRefs: ["p01", "p02", "p03"] };

const said = (spec: CarouselSpec) => spec.slides.map((slide) => slideText(slide).join(" ").replace(/\s+/g, " "));
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

describe("givenSpec", () => {
  test("one slide per text, every word hers, in order, with no keyword slide added", () => {
    const spec = givenSpec(SLIDES, { ...base, keyword: "CASH" });
    assert.equal(spec.slides.length, 7);
    assert.equal(spec.ownSlides, true);
    assert.deepEqual(said(spec), SLIDES.map(squash));
    assert.ok(spec.slides.every((slide) => slide.type !== "keyword"), "no keyword slide");
    assert.ok(!said(spec).join(" ").includes("AVATAR"), "the brand keyword is nowhere");
    assert.ok(!said(spec).some((text) => /\bslide\s*\d/i.test(text)), "no slide labels");
    assert.equal(spec.slides[0].type, "cover");
    // A slide that says two things sits on paper, headline over sentence.
    assert.deepEqual(spec.slides[2], { type: "paper", title: { lines: givenTitleLines("They read the caption and see the offer."), asTyped: true }, body: "That is where it starts." });
  });

  test("her case is kept even in a kit that sets titles in caps", () => {
    const spec = givenSpec(SLIDES, base);
    const first = spec.slides[0];
    assert.ok(first.type === "cover" && first.title.asTyped === true);
  });

  test("the caption is her first slide and, when her last slide asks, her ask", () => {
    assert.equal(givenCaption(SLIDES, "CASH"), "How a post turns into a sale. Comment CASH and I'll send it to you.");
    assert.equal(givenCaption(SLIDES), "How a post turns into a sale");
    assert.equal(givenSpec(SLIDES, { ...base, keyword: "CASH" }).caption, "How a post turns into a sale. Comment CASH and I'll send it to you.");
  });

  test("the writing checks leave her set alone", () => {
    const spec = givenSpec(SLIDES, { ...base, keyword: "CASH" });
    assert.deepEqual(checkSpec(spec, { profile }), []);
  });

  test("a set of two is hers to make, and a story still holds at most five", () => {
    assert.equal(givenSpec(["One thing", "Another thing"], base).slides.length, 2);
    assert.throws(() => givenSpec(SLIDES, { ...base, format: "story" }), /frames/);
  });

  test("an all-photo set puts every slide on a photo", () => {
    const spec = givenSpec(SLIDES, { ...base, layout: "photos" });
    assert.ok(spec.slides.every((slide) => slide.type === "cover"));
    assert.deepEqual(said(spec), SLIDES.map(squash));
  });

  test("a grid set opens on the grid and puts one line on each photo after it", () => {
    const spec = givenSpec(SLIDES, { ...base, layout: "grid" });
    assert.equal(spec.slides[0].type, "grid");
    assert.ok(spec.slides.slice(1).every((slide) => slide.type === "line"));
    assert.deepEqual(said(spec), SLIDES.map(squash));
  });

  test("a split set breaks each text in two; one that cannot be broken puts the set on photos", () => {
    const split = givenSpec(["can't gym?\nwalk for 10 min", "Post first. Edit later."], { ...base, layout: "split" });
    assert.deepEqual(split.slides.map((slide) => (slide.type === "split" ? slide.lines : null)), [["can't gym?", "walk for 10 min"], ["Post first.", "Edit later."]]);
    const fallback = givenSpec(["Hello", "Two words"], { ...base, layout: "split" });
    assert.equal(fallback.layout, "photos");
  });

  test("long text is never cut: at most four title lines, every word kept", () => {
    const long = "This is a long slide with many many words in it that she wrote all by herself without stopping once";
    const lines = givenTitleLines(long);
    assert.ok(lines.length <= 4);
    assert.equal(lines.join(" "), long);
  });
});

describe("the spec schema", () => {
  test("a written set still needs its keyword slide last", () => {
    const spec = givenSpec(SLIDES, base);
    const { ownSlides: _own, ...written } = spec;
    void _own;
    assert.equal(carouselSpecSchema.safeParse(written).success, false);
  });
});

describe("withKeyword", () => {
  test("the keyword she named replaces her brand's", () => assert.equal(withKeyword(profile, "CASH").keyword, "CASH"));
  test("nothing named keeps her brand's", () => assert.equal(withKeyword(profile, undefined).keyword, "AVATAR"));
  test("not one plain word is ignored", () => assert.equal(withKeyword(profile, "two words").keyword, "AVATAR"));
  test("with her brand off there is still no keyword to ask for", () => assert.equal(withKeyword(writerProfile(profile, false), "CASH").keyword, ""));
});

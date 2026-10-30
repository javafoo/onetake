import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ctaKeyword, cueKeyword, givenSlides, labelledScreenText, withGivenWords } from "./given-words";
import type { AgentRequest } from "./plan";

/* The words she wrote for the screen, found in her own message. The case that
   broke (2026-10-05, through Claude's create_post): a 7-slide carousel with
   every slide written out came back rewritten, with "Slide 1:" drawn on the
   slides, the whole request pasted onto slide 2 and "Comment AVATAR" added as
   an eighth slide in place of her "Comment CASH". */

const SLIDES = [
  "How a post turns into a sale",
  "Someone stops on your reel.",
  "They read the caption and see the offer.",
  "They comment the keyword.",
  "You send the guide in their DMs.",
  "The guide shows them the next step.",
  "Comment CASH and I'll send it to you.",
];

const REQUEST = `A 7-slide carousel. ${SLIDES.slice(0, -1)
  .map((text, index) => `Slide ${index + 1}: ${text}`)
  .join(" ")} Last slide: ${SLIDES[SLIDES.length - 1]}`;

/* What the reader made of that message: the whole request as the cover, and her slides as a model for shape. */
const READ: AgentRequest = {
  kind: "carousel",
  brief: "How a post turns into a sale",
  format: "carousel",
  cover: REQUEST,
  reference: SLIDES.map((text, index) => `Slide ${index + 1}: ${text}`).join("\n"),
  slides: 7,
};

describe("her slides, found in her message", () => {
  test("numbered slides come back word for word, in order, with the labels stripped", () => {
    assert.deepEqual(givenSlides(REQUEST), SLIDES);
    for (const slide of givenSlides(REQUEST)!) assert.doesNotMatch(slide, /\bslide\s*\d|last slide/i);
  });

  test("labels on their own lines: her numbers set the order, the cover is first, the last slide last, and a blank line ends a slide", () => {
    const message = [
      "Make me a carousel",
      "Last slide: Comment CASH for the guide.",
      "Slide 3 - The second step.",
      "Cover: Three steps to a sale",
      'Slide 2: "The first step."',
      "",
      "Use the boxed look please.",
    ].join("\n");
    assert.deepEqual(givenSlides(message), ["Three steps to a sale", "The first step.", "The second step.", "Comment CASH for the guide."]);
  });

  test("two or more lines in quotes are her slides", () => {
    const message = 'A carousel with these slides:\n"Nobody tells you this"\n- "Your first post will flop"\n3. "Post anyway."';
    assert.deepEqual(givenSlides(message), ["Nobody tells you this", "Your first post will flop", "Post anyway."]);
  });

  test("a topic, a single quoted cover, or someone else's set to make her version of is not a set of her own", () => {
    assert.equal(givenSlides("a carousel about how a post turns into a sale"), null);
    assert.equal(givenSlides('a carousel with the cover "How a post turns into a sale"'), null);
    assert.equal(givenSlides("a carousel to cover: the basics of good slide design"), null);
    assert.equal(givenSlides("Slide 1: one slide only"), null);
    assert.equal(givenSlides(`Make my version of this. ${REQUEST}`), null);
  });
});

describe("the keyword she names", () => {
  test("a word in capitals or in quotes after comment, DM or keyword", () => {
    assert.equal(ctaKeyword(REQUEST), "CASH");
    assert.equal(ctaKeyword("comment 'guide' below"), "guide");
    assert.equal(ctaKeyword("DM me PLAN"), "PLAN");
    assert.equal(ctaKeyword("CTA keyword: SALE"), "SALE");
  });

  test("ordinary words are not a keyword", () => {
    assert.equal(ctaKeyword("ask them to comment below"), null);
    assert.equal(ctaKeyword("the keyword is in the caption"), null);
    assert.equal(ctaKeyword("DM ME for details"), null);
    assert.equal(ctaKeyword("a carousel about comments"), null);
  });
});

describe("withGivenWords", () => {
  test("her slides replace the reader's cover and reference, and her keyword travels with them", () => {
    const given = withGivenWords(READ, REQUEST);
    assert.ok(given.kind === "run" && given.request.kind === "carousel");
    const request = given.request;
    assert.deepEqual(request.slideTexts, SLIDES);
    assert.equal(request.slides, 7);
    assert.equal(request.keyword, "CASH");
    // The raw request is never a slide: no cover pinned from it, no reference to rewrite from.
    assert.equal(request.cover, undefined);
    assert.equal(request.reference, undefined);
    assert.equal(request.coverTemplate, undefined);
  });

  test("a set with no slides of hers is left as it was", () => {
    const request: AgentRequest = { kind: "carousel", brief: "three mistakes new creators make", format: "carousel", cover: "Three mistakes I made" };
    assert.deepEqual(withGivenWords(request, 'a carousel about three mistakes, cover "Three mistakes I made"'), { kind: "run", request });
  });

  test("a keyword she names with no slides is the set's keyword", () => {
    const request: AgentRequest = { kind: "carousel", brief: "how a post turns into a sale", format: "carousel" };
    const given = withGivenWords(request, "a carousel about how a post turns into a sale, ending on comment CASH");
    assert.deepEqual(given, { kind: "run", request: { ...request, keyword: "CASH" } });
  });

  test("a cover the reader copied from the whole request is dropped", () => {
    const message = "make a carousel about how a post turns into a sale";
    const request: AgentRequest = { kind: "carousel", brief: "how a post turns into a sale", format: "carousel", cover: message };
    const given = withGivenWords(request, message);
    assert.ok(given.kind === "run" && given.request.kind === "carousel");
    assert.equal(given.request.cover, undefined);
  });

  test("more slides than the format holds is answered in words, not cut short", () => {
    const eleven = Array.from({ length: 11 }, (_, index) => `Slide ${index + 1}: Point ${index + 1}.`).join(" ");
    const given = withGivenWords({ ...READ, cover: undefined }, `A carousel. ${eleven}`);
    assert.equal(given.kind, "chat");
    assert.match(given.kind === "chat" ? given.reply : "", /up to 10 slides/);
  });

  test("a reel takes her labelled on-screen words as its hook, and her keyword", () => {
    const reel: AgentRequest = { kind: "reel", brief: "posting without showing your face", footage: "auto", cue: "auto", talking: false };
    const given = withGivenWords(reel, 'A reel. On-screen text: "Nobody needs to see your face" and comment CASH for the guide');
    assert.ok(given.kind === "run" && given.request.kind === "reel");
    assert.equal(given.request.hook, "Nobody needs to see your face");
    assert.equal(given.request.keyword, "CASH");
    assert.equal(labelledScreenText("Hook: I never film myself\nabout privacy"), "I never film myself");
  });

  test("a reel with nothing of hers is left as it was", () => {
    const reel: AgentRequest = { kind: "reel", brief: "posting without showing your face", footage: "auto", cue: "auto", talking: false };
    assert.deepEqual(withGivenWords(reel, "a reel about posting without showing your face"), { kind: "run", request: reel });
  });

  test("a quote post takes her labelled words in place of writing some", () => {
    const photo: AgentRequest = { kind: "photos", brief: "a calm morning", count: 1, mode: "one", wordsBrief: "a line about slow mornings" };
    const given = withGivenWords(photo, "a quote post. Text on screen: Slow mornings are a skill");
    assert.ok(given.kind === "run" && given.request.kind === "photos");
    assert.equal(given.request.words, "Slow mornings are a skill");
    assert.equal(given.request.wordsBrief, undefined);
  });
});

describe("the keyword a reel's second line may ask for", () => {
  const reel: Extract<AgentRequest, { kind: "reel" }> = { kind: "reel", brief: "b", footage: "auto", cue: "auto", talking: false };
  const on = { keyword: "AVATAR" };
  const off = { keyword: "", brandOff: true };
  test("her brand's, when the words are the writer's", () => assert.equal(cueKeyword(reel, on), "AVATAR"));
  test("none, when the words on screen are hers", () => assert.equal(cueKeyword({ ...reel, hook: "Nobody needs to see your face" }, on), ""));
  test("hers, when she named one", () => assert.equal(cueKeyword({ ...reel, hook: "Her hook", keyword: "CASH" }, on), "CASH"));
  test("none with the brand off, even one she named", () => {
    assert.equal(cueKeyword(reel, off), "");
    assert.equal(cueKeyword({ ...reel, keyword: "CASH" }, off), "");
  });
});

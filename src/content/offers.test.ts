import assert from "node:assert/strict";
import { test } from "node:test";

import type { Brief } from "../brief/build";
import { checkSpec } from "../carousel/check";
import { carouselSpecSchema } from "../carousel/spec";
import { carouselPrompt } from "../carousel/write";
import { resolveKit } from "../carousel/kits";
import { checkDraftEdit } from "./draft-edit";
import { writerPrompt, type BrandProfile } from "./hooks";
import { briefForOffer, keywordsOf, offerIndexOfKeyword, offersOf, pickOffer, profileForRequest, readOfferRows, withOffer } from "./offers";

const PROFILE: BrandProfile = {
  niche: "Faceless Instagram with an AI avatar",
  audience: "Women in a 9-5 who hate being on camera",
  offer: "The 7-day faceless starter kit",
  keyword: "AVATAR",
  voice: "Warm, direct",
  proofPoints: ["12,000 followers in 5 months"],
  offers: [
    { offer: "Done-for-you carousel templates in Canva", keyword: "CANVA" },
    { offer: "1:1 coaching, four weeks of calls", keyword: "COACH" },
  ],
};

const source = "Brand page";
const BRIEF: Brief = {
  builtAt: "2026-10-01T00:00:00.000Z",
  sources: [],
  oneLiner: { text: "Who: women in a 9-5. Offer: The 7-day faceless starter kit. Comment AVATAR.", source },
  audience: [],
  problem: [],
  offer: [{ text: "The 7-day faceless starter kit", source }, { text: "They comment AVATAR to get it.", source }],
  story: { before: { text: "", source }, turn: { text: "", source }, after: { text: "", source } },
  pointOfView: [],
  voiceIs: [],
  voiceIsNot: [],
  proof: [],
  positioningLines: [{ text: "The 7-day faceless starter kit. Comment AVATAR and I will send it to you.", source }],
  conflicts: [],
};

test("a profile saved before offers existed is one offer", () => {
  const { offers, ...old } = PROFILE;
  void offers;
  assert.deepEqual(offersOf(old), [{ offer: PROFILE.offer, keyword: "AVATAR" }]);
  assert.deepEqual(keywordsOf(old), ["AVATAR"]);
  assert.equal(pickOffer(old, "a reel about COACH calls"), 0);
  assert.equal(profileForRequest(old, "anything"), old);
});

test("the default comes first, then the others in the order saved", () => {
  assert.deepEqual(keywordsOf(PROFILE), ["AVATAR", "CANVA", "COACH"]);
});

test("a malformed or repeated extra from the json row is skipped", () => {
  const profile = {
    ...PROFILE,
    offers: [
      { offer: "Repeat", keyword: "avatar" },
      { offer: "", keyword: "EMPTY" },
      { offer: "Two words", keyword: "TWO WORDS" },
      { offer: 7, keyword: "NUM" },
      null,
      { offer: "Fine", keyword: "FINE" },
    ] as unknown as BrandProfile["offers"],
  };
  assert.deepEqual(keywordsOf(profile), ["AVATAR", "FINE"]);
});

test("naming a keyword picks its offer, in any case", () => {
  assert.equal(pickOffer(PROFILE, "make a reel for my coach offer"), 2);
  assert.equal(pickOffer(PROFILE, "carousel, keyword canva"), 1);
  assert.equal(pickOffer(PROFILE, "a talking reel, Comment AVATAR"), 0);
});

test("words only one offer has pick it", () => {
  assert.equal(pickOffer(PROFILE, "a carousel selling my templates"), 1);
  assert.equal(pickOffer(PROFILE, "talk about the weekly calls we do"), 2);
});

test("nothing clear keeps the default", () => {
  assert.equal(pickOffer(PROFILE, "a reel about my morning routine"), 0);
  assert.equal(pickOffer(PROFILE, ""), 0);
  assert.equal(pickOffer(PROFILE, null), 0);
  // "guide" and "offer" are too common to decide anything.
  assert.equal(pickOffer(PROFILE, "my guide offer"), 0);
});

test("withOffer puts the chosen offer where every writer reads it", () => {
  const chosen = withOffer(PROFILE, 2);
  assert.equal(chosen.offer, "1:1 coaching, four weeks of calls");
  assert.equal(chosen.keyword, "COACH");
  // The rest stay behind it, the old default among them, so nothing is lost.
  assert.deepEqual(keywordsOf(chosen), ["COACH", "AVATAR", "CANVA"]);
  assert.equal(withOffer(PROFILE, 0), PROFILE);
  assert.equal(withOffer(PROFILE, 9), PROFILE);
  assert.equal(withOffer(PROFILE, -1), PROFILE);
});

test("the writers are handed the chosen offer and keyword, not the default", () => {
  const { prompt } = writerPrompt(profileForRequest(PROFILE, "3 hooks for COACH"), 3);
  assert.match(prompt, /1:1 coaching, four weeks of calls/);
  assert.match(prompt, /COACH/);
  assert.doesNotMatch(prompt, /7-day faceless starter kit/);
});

test("the brief sells the chosen offer", () => {
  const brief = briefForOffer(BRIEF, PROFILE, 1);
  assert.ok(brief);
  assert.deepEqual(brief.offer.map((line) => line.text), ["Done-for-you carousel templates in Canva", "They comment CANVA to get it."]);
  assert.equal(brief.oneLiner.text, "Who: women in a 9-5. Offer: Done-for-you carousel templates in Canva. Comment CANVA.");
  assert.equal(brief.positioningLines[0].text, "Done-for-you carousel templates in Canva. Comment CANVA and I will send it to you.");
  // The default offer leaves the brief exactly as it was.
  assert.equal(briefForOffer(BRIEF, PROFILE, 0), BRIEF);
  assert.equal(briefForOffer(null, PROFILE, 1), null);
});

test("a carousel for another offer is written for its keyword and passes the keyword check", () => {
  const profile = withOffer(PROFILE, offerIndexOfKeyword(PROFILE, "coach"));
  const kit = resolveKit("signal", {});
  const { prompt } = carouselPrompt({
    topic: "what four weeks of calls changed",
    profile,
    brief: briefForOffer(BRIEF, PROFILE, 2),
    kit,
    skeleton: "case_study",
    format: "carousel",
    name: "test",
    photoRefs: ["p00"],
  });
  assert.match(prompt, /Comment keyword \(the last slide and the caption use this exact word\): COACH/);

  const spec = carouselSpecSchema.parse({
    name: "coach-set",
    caption: "Comment COACH and I will send you the details.",
    slides: [
      { type: "cover", photo: "p00", title: { lines: ["Four weeks of calls"] } },
      { type: "paper", title: { lines: ["What changed"] }, body: "We met every week." },
      { type: "paper", title: { lines: ["What I stopped"] }, body: "I stopped filming myself." },
      { type: "paper", title: { lines: ["What I kept"] }, body: "I kept posting every day." },
      { type: "keyword", keyword: "COACH", promise: "I will send you the details." },
    ],
  });
  const keywordProblems = (sources: Parameters<typeof checkSpec>[1]) => checkSpec(spec, sources).filter((problem) => problem.rule === "keyword-word");
  assert.equal(keywordProblems({ profile: PROFILE, brief: BRIEF }).length, 1, "checked against the default it fails");
  const index = offerIndexOfKeyword(PROFILE, "COACH");
  assert.deepEqual(keywordProblems({ profile: withOffer(PROFILE, index), brief: briefForOffer(BRIEF, PROFILE, index) }), []);
});

test("a hand-edited call to action may ask for any of her keywords", () => {
  const edit = { hook: "I stopped filming myself and it worked", caption: "Here is how.", cta: "Comment COACH for the details." };
  assert.equal(checkDraftEdit(edit, keywordsOf(PROFILE)).cta, edit.cta);
  assert.throws(() => checkDraftEdit({ ...edit, cta: "Link in bio." }, keywordsOf(PROFILE)), /one of your keywords \(AVATAR, CANVA, COACH\)/);
  // A single keyword reads as it always did.
  assert.throws(() => checkDraftEdit({ ...edit, cta: "Link in bio." }, "AVATAR"), /the keyword "AVATAR"/);
});

test("Brand page rows: both boxes or neither, one word, no repeats", () => {
  const ok = readOfferRows(
    [
      { offer: " Canva templates ", keyword: "canva" },
      { offer: "", keyword: "" },
      { offer: "Coaching", keyword: "Coach" },
    ],
    "AVATAR",
  );
  assert.deepEqual(ok, { offers: [{ offer: "Canva templates", keyword: "CANVA" }, { offer: "Coaching", keyword: "COACH" }] });
  assert.deepEqual(readOfferRows([], "AVATAR"), { offers: [] });

  const error = (rows: { offer: string; keyword: string }[]) => {
    const result = readOfferRows(rows, "AVATAR");
    return "error" in result ? result.error : "";
  };
  assert.match(error([{ offer: "Coaching", keyword: "" }]), /Offer 2 needs its own comment keyword/);
  assert.match(error([{ offer: "", keyword: "COACH" }]), /Offer 2 has a keyword but no offer/);
  assert.match(error([{ offer: "Coaching", keyword: "my coach" }]), /one word/);
  assert.match(error([{ offer: "Coaching", keyword: "avatar" }]), /AVATAR is used twice/);
  assert.match(error([{ offer: "A", keyword: "ONE" }, { offer: "B", keyword: "one" }]), /ONE is used twice/);
  // Accented keywords are words too.
  assert.deepEqual(readOfferRows([{ offer: "Ghid", keyword: "ȘTIU" }], "AVATAR"), { offers: [{ offer: "Ghid", keyword: "ȘTIU" }] });
});

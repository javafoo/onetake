import assert from "node:assert/strict";
import { test } from "node:test";

import type { BrandProfile } from "../content/hooks";
import { compile, SOURCE } from "../onboarding/compile";
import { recordAnswer, start } from "../onboarding/state";

import type { Brief } from "./build";
import { applyBrandForm, BRAND_SOURCE, joinStory, parseVoice, storyBeatsFor, type BrandForm } from "./sync";

const T = "2026-09-21T10:00:00.000Z";
const LATER = "2026-09-24T10:00:00.000Z";

function setup() {
  let state = start({ avatarKind: "avatar", personaName: "Nova", niche: "faceless marketing" }, T);
  state = recordAnswer(state, "audience", { text: "Women in a 9-5 who will not show their face." }, "typed", T);
  state = recordAnswer(state, "problem", { text: "I post every day and nobody sees it." }, "typed", T);
  state = recordAnswer(state, "offer", { text: "A starter kit with reel templates.", keyword: "KIT" }, "typed", T);
  state = recordAnswer(
    state,
    "story",
    { before: "My account was dead", turn: "I built an avatar", now: "I post twice a day" },
    "typed",
    T,
  );
  state = recordAnswer(state, "proof", { points: ["285,000 followers"] }, "typed", T);
  state = recordAnswer(state, "pov", { text: "The tool is the easy part." }, "typed", T);
  state = recordAnswer(state, "voice", { label: "dry and direct", caption: "Short. Plain.", is: ["short sentences"], isNot: ["hype"] }, "typed", T);
  return compile(state, T);
}

function formFrom(profile: BrandProfile, brief: Brief | null): BrandForm {
  return {
    profile: { ...profile },
    story: storyBeatsFor(profile, brief),
    problem: brief?.problem.map((item) => item.text) ?? [],
    pointOfView: brief?.pointOfView.map((item) => item.text) ?? [],
  };
}

test("saving the Brand page unchanged leaves the brief as it was", () => {
  const { profile, brief } = setup();
  const result = applyBrandForm(brief, profile, formFrom(profile, brief), LATER);
  assert.deepEqual(result.brief, brief);
  assert.equal(result.profile.story, profile.story);
});

test("a changed offer rewrites the offer, one-liner and positioning, and nothing else", () => {
  const { profile, brief } = setup();
  const form = formFrom(profile, brief);
  form.profile.offer = "A free guide to your first ten reels.";
  form.profile.keyword = "GUIDE";
  const result = applyBrandForm(brief, profile, form, LATER).brief;

  assert.deepEqual(result.offer.map((item) => item.text), ["A free guide to your first ten reels.", "They comment GUIDE to get it."]);
  assert.ok(result.offer.every((item) => item.source === BRAND_SOURCE));
  assert.match(result.oneLiner.text, /Offer: A free guide to your first ten reels\. Comment GUIDE\./);
  assert.ok(result.positioningLines.some((item) => item.text.includes("Comment GUIDE")));
  assert.deepEqual(result.audience, brief.audience);
  assert.deepEqual(result.story, brief.story);
  assert.deepEqual(result.voiceIsNot, brief.voiceIsNot);
  assert.equal(result.builtAt, LATER);
});

test("story beats round-trip, and an edited beat lands in both the profile and the brief", () => {
  const { profile, brief } = setup();
  const form = formFrom(profile, brief);
  assert.deepEqual(form.story, { before: "My account was dead", turn: "I built an avatar", now: "I post twice a day" });

  form.story.now = "I post three times a day";
  const result = applyBrandForm(brief, profile, form, LATER);
  assert.equal(result.brief.story.after.text, "I post three times a day");
  assert.equal(result.brief.story.after.source, BRAND_SOURCE);
  assert.equal(result.brief.story.before.source, BRAND_SOURCE);
  assert.equal(result.profile.story, "My account was dead. I built an avatar. I post three times a day.");
});

test("a story out of step with the brief is shown whole rather than split at a guess", () => {
  const { profile, brief } = setup();
  const edited = { ...profile, story: "A paragraph written on the old Brand page." };
  assert.deepEqual(storyBeatsFor(edited, brief), { before: "A paragraph written on the old Brand page.", turn: "", now: "" });

  const result = applyBrandForm(brief, edited, formFrom(edited, brief), LATER);
  assert.equal(result.profile.story, "A paragraph written on the old Brand page.");
  assert.deepEqual(result.brief.story, brief.story);
});

test("problem and point of view are edited one line per item", () => {
  const { profile, brief } = setup();
  const form = formFrom(profile, brief);
  form.problem = ["I post and nobody sees it.", "  ", "I bought two courses."];
  const result = applyBrandForm(brief, profile, form, LATER).brief;
  assert.deepEqual(result.problem.map((item) => item.text), ["I post and nobody sees it.", "I bought two courses."]);
  assert.match(result.oneLiner.text, /Stuck on: I post and nobody sees it\./);
  assert.deepEqual(result.pointOfView, brief.pointOfView);
});

test("voice written by setup is read back into its brief sections", () => {
  const { profile } = setup();
  assert.deepEqual(parseVoice(profile.voice), { label: "Dry and direct", is: ["short sentences"], isNot: ["hype"] });
  assert.deepEqual(parseVoice("Warm, a little dry"), { label: "Warm, a little dry", is: [], isNot: [] });
});

test("without a brief every section is written from the form", () => {
  const { profile } = setup();
  const form: BrandForm = {
    profile,
    story: { before: "Dead account", turn: "", now: "Posting daily" },
    problem: ["Nobody sees it."],
    pointOfView: [],
  };
  const result = applyBrandForm(null, profile, form, LATER);
  assert.equal(result.brief.sources.length, 0);
  assert.equal(result.brief.story.before.text, "Dead account");
  assert.equal(result.brief.story.turn.text, "");
  assert.equal(result.profile.story, joinStory(form.story));
  assert.ok(result.brief.proof.length > 0);
  assert.ok(!result.brief.oneLiner.text.includes(": ."));
  assert.ok([result.brief.oneLiner, ...result.brief.audience].every((item) => item.source === BRAND_SOURCE));
});

test("lines from setup keep their source when another field changes", () => {
  const { profile, brief } = setup();
  const form = formFrom(profile, brief);
  form.profile.proofPoints = ["300,000 followers"];
  const result = applyBrandForm(brief, profile, form, LATER).brief;
  assert.ok(result.audience.every((item) => item.source === SOURCE));
  assert.ok(result.proof.every((item) => item.source === BRAND_SOURCE));
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { factCheckPrompt, keepLines, templatePrompt, templateShape } from "./hooks";
import { sourcedPrompt } from "./scene";

const LAURA = `My name is Laura
I hate filming in public

So I sent Claude a selfie photo
Asked it to create 30 b-roll videos

Now all my content is done for the month (without filming a thing)`;

test("a template's lines and groups are counted as they are laid out", () => {
  assert.deepEqual(templateShape(LAURA), { lines: 5, groups: 3 });
  assert.deepEqual(templateShape("One line only"), { lines: 1, groups: 1 });
});

test("the adapt instruction keeps the layout and swaps only what is someone else's, for hers", () => {
  const prompt = templatePrompt(LAURA, { personaName: "Maya", offer: "A beginner guide to AI avatars", proofPoints: [] });
  assert.match(prompt, /exactly 5 lines in 3 groups/);
  assert.match(prompt, /"Maya"/);
  assert.match(prompt, /"A beginner guide to AI avatars"/);
  assert.match(prompt, /my business/);
  assert.match(prompt, /she has none/);
  assert.match(prompt, /Never keep someone else's name, brand or claim/);
  assert.ok(prompt.endsWith(LAURA), "the template is given whole, last");
  // With no persona name, a name is dropped, never made up.
  assert.match(templatePrompt(LAURA, { offer: "", proofPoints: ["2,000 followers in a month"] }), /leave the name out/);
});

test("a photo drawn from her attached photos says which images are which", () => {
  assert.equal(sourcedPrompt("P", "same outfit", 4, 0), "P");
  const one = sourcedPrompt("P", " same outfit at a café ", 4, 1);
  assert.match(one, /Image 5 is an earlier photo/);
  assert.match(one, /same outfit at a café\./);
  assert.match(one, /first 4 images/);
  assert.match(sourcedPrompt("P", "extend to 16:9", 5, 3), /Images 6 to 8 are/);
});

test("the fact-check may change words in an adapted hook but not its lines", () => {
  const written = "My name is Maya\nAsked it for 30 videos";
  assert.equal(keepLines(written, "My name is Maya\nAsked it for videos"), "My name is Maya\nAsked it for videos");
  // A literal backslash-n from the checker is read as the line break it meant.
  assert.equal(keepLines(written, "My name is Maya\\nAsked it for videos"), "My name is Maya\nAsked it for videos");
  // Lines merged or dropped: the writer's lines stand.
  assert.equal(keepLines(written, "I built an avatar and asked it for videos"), written);
});

test("the fact-check takes her offer as allowed ground and still blocks history, numbers and money", () => {
  const profile = {
    personaName: "Maya",
    story: "Built an AI avatar after years of not wanting to film.",
    proofPoints: ["Posts every day"],
    offer: "An AI avatar app: send it one selfie and it makes photos and b-roll videos of you",
    niche: "faceless content for small business owners",
  };
  const { system, prompt } = factCheckPrompt(profile, [{ hook: "So I sent my AI avatar a selfie photo", caption: "c" }], true);
  // The offer is in the prompt, named as allowed ground.
  assert.match(prompt, /ALLOWED GROUND: HER OFFER/);
  assert.ok(prompt.includes(profile.offer));
  assert.ok(prompt.includes(profile.niche));
  // Product use is not history...
  assert.match(system, /what her product or offer does, or how she uses it/);
  assert.match(system, /Never flag or rewrite such a line as invented history/);
  // ...but invented history, numbers and money still are.
  assert.match(system, /not in the story/);
  assert.match(system, /number that is not in the proof points/);
  assert.match(system, /money, income, earnings/);
  // An adapted hook keeps its lines.
  assert.match(prompt, /never rewrite, merge, add or drop a line/);
});

test("the fact-check says so when there is no offer", () => {
  const { prompt } = factCheckPrompt({ proofPoints: [], offer: " ", niche: "" }, [{ hook: "h", caption: "c" }]);
  assert.match(prompt, /Offer: \(none\)/);
  assert.match(prompt, /Proof points:\n- \(none\)/);
});

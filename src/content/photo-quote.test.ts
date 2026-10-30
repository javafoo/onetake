import assert from "node:assert/strict";
import { test } from "node:test";

import type { generateText } from "../ai/text";

import type { BrandProfile } from "./hooks";
import { tidyPhotoWords, writePhotoWords } from "./photo-quote";

/* The photo-words writer, with the model stood in for: what it is asked, and what comes back. */

const profile: BrandProfile = { niche: "AI avatars", audience: "creators who will not film", offer: "a guide", keyword: "AVATAR", voice: "plain and warm", proofPoints: ["285K followers"] };

test("the line comes back as it goes on the photo: one line, no wrapping quotes, no hashtags", () => {
  assert.equal(tidyPhotoWords('  "delusion is only a problem\nif you fail"  '), "delusion is only a problem if you fail");
  assert.equal(tidyPhotoWords("soft life, hard boundaries #mood #sunday"), "soft life, hard boundaries");
});

test("it is asked for her subject in her voice, without her audience or proof points pulling it toward her niche", async () => {
  let prompt = "";
  const model = (async (options: { prompt: string }) => {
    prompt = options.prompt;
    return { words: "“act like you already won”" };
  }) as unknown as typeof generateText;
  const words = await writePhotoWords(profile, "a slightly unhinged life quote", model);
  assert.equal(words, "act like you already won");
  assert.match(prompt, /slightly unhinged life quote/);
  assert.match(prompt, /plain and warm/);
  assert.doesNotMatch(prompt, /creators who will not film|285K/);
});

test("an empty answer is a sentence she can act on, not an empty photo", async () => {
  const model = (async () => ({ words: "  " })) as unknown as typeof generateText;
  await assert.rejects(() => writePhotoWords(profile, "a quote", model), /type your own in quotes/);
});

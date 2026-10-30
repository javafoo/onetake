import assert from "node:assert/strict";
import { test } from "node:test";

import type { ModelCall } from "./lock";
import { draftLock, rebuildLock } from "./lock";

const CLEAN = {
  subject: "a woman in her early 20s, slender build",
  hair: "long dark brown hair parted in the middle, styled in loose waves",
  skinMakeup: "warm tan skin, peachy blush, glossy nude-pink lips",
  accessories: "small gold hoop earrings, a thin gold chain",
  expressions: "a relaxed closed-lip smile, a calm direct glance",
  wardrobe: ["white ribbed tank top", "grey crewneck sweatshirt"],
  scenes: ["driver seat of a parked car", "sunlit living room couch"],
};

const IMAGES = [{ mimeType: "image/jpeg", data: Buffer.from("not a real photo") }];

/* A stand-in for the house style's lists, which are server-only and cannot be
   loaded here. The words are the ones the drafts below use. */
const WORDS = ["european", "latina", "flawless", "porcelain", "pores"];

function queue(replies: unknown[]): { model: ModelCall; prompts: string[] } {
  const prompts: string[] = [];
  const model = (async (options: { prompt: string }) => {
    prompts.push(options.prompt);
    const reply = replies.shift();
    if (reply === undefined) throw new Error("the model was called more times than the test allows");
    return reply;
  }) as ModelCall;
  return { model, prompts };
}

test("a clean draft comes back with an empty per-avatar banned list", async () => {
  const { model, prompts } = queue([CLEAN]);
  const lock = await draftLock(IMAGES, { model, words: WORDS });
  assert.deepEqual(lock.bannedWords, []);
  assert.equal(lock.wardrobe.length, 2);
  assert.equal(prompts.length, 1);
});

test("a nationality word costs one retry, and the retry names the word", async () => {
  const { model, prompts } = queue([
    { ...CLEAN, scenes: ["a European city street in the sun", "sunlit living room couch"] },
    CLEAN,
  ]);
  const lock = await draftLock(IMAGES, { model, words: WORDS });
  assert.deepEqual(lock.scenes, CLEAN.scenes);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /european/i);
});

test("a second banned draft fails loudly rather than reaching a photo prompt", async () => {
  const { model, prompts } = queue([
    { ...CLEAN, subject: "a Latina woman in her early 20s" },
    { ...CLEAN, skinMakeup: "flawless porcelain skin with no visible pores" },
  ]);
  await assert.rejects(() => draftLock(IMAGES, { model, words: WORDS }), /still uses words that are not allowed/);
  assert.equal(prompts.length, 2);
});

test("no photos is a programming error, not a model call", async () => {
  const { model, prompts } = queue([CLEAN]);
  await assert.rejects(() => draftLock([], { model, words: WORDS }), /at least one reference photo/);
  assert.equal(prompts.length, 0);
});

test("an everyday draft asks for phone-photo places and stores no style", async () => {
  const { model, prompts } = queue([CLEAN]);
  const lock = await draftLock(IMAGES, { model, words: WORDS });
  assert.match(prompts[0], /Somewhere a phone photo happens/);
  assert.equal("photoStyle" in lock, false);
});

test("an editorial draft asks for sets, not phone-photo places, and stores the style", async () => {
  const { model, prompts } = queue([CLEAN]);
  const lock = await draftLock(IMAGES, { model, words: WORDS, style: "editorial" });
  assert.doesNotMatch(prompts[0], /phone photo/);
  assert.match(prompts[0], /director's chair/);
  assert.equal(lock.photoStyle, "editorial");
});

test("rebuilding keeps the words her past photos taught us, and takes the rest from the new draft", async () => {
  const { model } = queue([CLEAN]);
  const drafted = await draftLock(IMAGES, { model, words: WORDS, style: "editorial" });
  const existing = { ...drafted, hair: "short bob", wardrobe: ["old hoodie"], bannedWords: ["glow", "dewy"] };
  const next = rebuildLock(existing, drafted);
  assert.deepEqual(next.bannedWords, ["glow", "dewy"]);
  assert.equal(next.hair, drafted.hair);
  assert.deepEqual(next.wardrobe, drafted.wardrobe);
  assert.equal(next.photoStyle, "editorial");
  assert.deepEqual(rebuildLock(null, drafted).bannedWords, []);
});

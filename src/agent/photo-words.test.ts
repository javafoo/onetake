import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { creditsFor } from "@/billing/pricing";
import { DEFAULT_IMAGE_MODEL } from "@/content/image-options";

import { withOptions } from "./options";
import { readerSystem } from "./understand";
import {
  asksForPhotoLikeThis,
  photoLikeScreenshot,
  photoWithWords,
  photoWordsLevel,
  QUOTE_PHOTO_REPLY,
  QUOTE_PHOTO_WRITE_REPLY,
  quotePhotoFromReading,
  sceneForQuote,
  withFraming,
  withPhotoPrice,
} from "./photo-words";
import { TEXT_PHOTO_NEEDS_PHOTO, TEXT_PHOTO_NEEDS_WORDS, textPhotoFromReading } from "./text-photo";
import { agentCredits, agentNoun, carryOver, initialState, markStep, remainingCredits, stepsFor, type AgentRequest } from "./plan";
import { withTextLook } from "./text-look";

const QUOTE = "this era is called: moving like i should have been a long time ago & never looking back.";
const FOUNDER = "create a photo of maya like this, working out in active wear, sweaty, same angle of her face and upper chest, with the words on it";
const PHOTO = creditsFor({ kind: "image", model: DEFAULT_IMAGE_MODEL });

const reading = (message: string, extra: Partial<Parameters<typeof photoLikeScreenshot>[0]> = {}) => ({
  message,
  kind: "photos",
  words: QUOTE,
  brief: "Maya working out in active wear, sweaty, a close crop of her face and upper chest.",
  framing: "A close crop from her chin to mid-chest, camera straight on at chest height.",
  style: "bold",
  screenshots: 1,
  photos: 0,
  ...extra,
});

test("a new photo like the screenshot is asked for in plain words", () => {
  assert.ok(asksForPhotoLikeThis(FOUNDER));
  assert.ok(asksForPhotoLikeThis("a selfie of her, same vibe"));
  assert.ok(asksForPhotoLikeThis("make a picture like the screenshot"));
  assert.ok(!asksForPhotoLikeThis("add this quote to this photo"), "no likeness asked for");
  assert.ok(!asksForPhotoLikeThis("make a reel like this"), "not a photo");
});

test("which words: the screenshot's unless she asks for her own, none when she says so", () => {
  assert.equal(photoWordsLevel(FOUNDER), "exact");
  assert.equal(photoWordsLevel("a photo like this with the same quote"), "exact");
  assert.equal(photoWordsLevel("photo like this with these words"), "exact");
  assert.equal(photoWordsLevel("photo like this with a quote like this"), "own");
  assert.equal(photoWordsLevel("same angle photo but in my own words"), "own");
  assert.equal(photoWordsLevel("photo like this, without the words"), "none");
  assert.equal(photoWordsLevel('photo like this with "my own line" on it'), "exact", "quoted words are hers, exactly");
});

test("the founder's case is one photo with the screenshot's words, exactly", () => {
  const result = photoLikeScreenshot(reading(FOUNDER));
  assert.ok(result && result.kind === "run");
  assert.equal(result.request.kind, "photos");
  assert.equal(result.request.count, 1);
  assert.equal(result.request.mode, "one");
  assert.equal(result.request.words, QUOTE);
  assert.equal(result.request.wordsLike, undefined);
  assert.equal(result.request.style, "bold");
  assert.match(result.request.brief, /chin to mid-chest/, "the framing is in the brief the planner reads");
  assert.equal(result.request.framing, "A close crop from her chin to mid-chest, camera straight on at chest height.");
});

test("the reader calling it words on a photo does not ask her to attach one when she wants a new photo", () => {
  const result = photoLikeScreenshot(reading(FOUNDER, { kind: "text_photo" }));
  assert.ok(result && result.kind === "run");
  assert.equal(result.request.words, QUOTE);
});

test("a quote like this is written in her voice from the screenshot's shape", () => {
  const result = photoLikeScreenshot(reading("a photo of her like this with a quote like this"));
  assert.ok(result && result.kind === "run");
  assert.equal(result.request.words, undefined);
  assert.equal(result.request.wordsLike, QUOTE);
});

test("without the words it is the photo alone", () => {
  const result = photoLikeScreenshot(reading("a photo of her like this, no text"));
  assert.ok(result && result.kind === "run");
  assert.equal(photoWithWords(result.request), false);
});

test("it stays out of the way: her own photo attached, no screenshot, a reel, or no likeness", () => {
  assert.equal(photoLikeScreenshot(reading(FOUNDER, { photos: 1 })), null, "words go on her attached photo instead");
  assert.equal(photoLikeScreenshot(reading(FOUNDER, { screenshots: 0 })), null);
  assert.equal(photoLikeScreenshot(reading(FOUNDER, { kind: "reel" })), null);
  assert.equal(photoLikeScreenshot(reading("add this quote to this photo", { kind: "text_photo", framing: "" })), null);
});

test("a photo with words is priced as the photo, and the words are a free step after it", () => {
  const request: AgentRequest = { kind: "photos", brief: "x", count: 1, mode: "one", words: QUOTE, style: "bold" };
  assert.deepEqual(stepsFor(request), ["plan", "photos", "words"]);
  assert.deepEqual(stepsFor({ kind: "photos", brief: "x", count: 1, mode: "one" }), ["plan", "photos"]);
  assert.equal(agentCredits(request), PHOTO);
  assert.equal(agentCredits({ ...request, model: "pro" }), creditsFor({ kind: "image", model: "pro" }));
  assert.equal(agentNoun(request), "photo with words");

  // Photo done, words failed: the retry keeps the photo and charges nothing.
  let state = initialState(request, { photoMediaId: "photo_new", mediaIds: ["photo_new"] });
  state = markStep(markStep(state, "plan", "done"), "photos", "done");
  state = markStep(state, "words", "failed");
  const retry = initialState(request, carryOver(state));
  assert.equal(retry.photoMediaId, "photo_new");
  assert.equal(remainingCredits(request, retry), 0);
});

test("the Text picker and her words about size and case reach a photo with words, and only then", () => {
  const request: AgentRequest = { kind: "photos", brief: "x", count: 1, mode: "one", words: QUOTE };
  const picked = withOptions(request, { style: "serif", size: "small", lowercase: true });
  assert.ok(picked.kind === "photos");
  assert.equal(picked.style, "serif");
  assert.equal(picked.size, "small");
  const plain = withOptions({ kind: "photos", brief: "x", count: 1, mode: "one" }, { style: "serif" });
  assert.ok(plain.kind === "photos");
  assert.equal(plain.style, undefined);
  const looked = withTextLook(request, { size: "small" });
  assert.ok(looked.kind === "photos");
  assert.equal(looked.size, "small");
});

test("every planned scene carries the framing once", () => {
  const scenes = withFraming([{ idea: "In a gym, after a set.", shot: "friend", why: "" }], "A close crop from chin to mid-chest.");
  assert.equal(scenes[0].idea, "In a gym, after a set. Framing, as in her reference: A close crop from chin to mid-chest.");
  assert.deepEqual(withFraming(scenes, "A close crop from chin to mid-chest."), scenes);
  assert.deepEqual(withFraming(scenes, undefined), scenes);
});

/* A quote post with nothing attached (the founder's runs of 2026-10-05, each
   made into an eight-slide carousel): one new photo, the quote on a copy. */
describe("a quote post with no photo attached", () => {
  const NEW_YEAR = "Entering the new year prepared isn't about setting more goals; it's about clearing out the noise so you actually have room for what matters.";
  const quoteReading = (message: string, extra: Partial<Parameters<typeof quotePhotoFromReading>[0]> = {}) => ({
    message,
    kind: "photos",
    quote: true,
    words: "",
    brief: "A quote about preparing for the new year.",
    scene: "She sits at a desk with a fresh notebook in soft morning light.",
    style: "boxed",
    screenshots: 0,
    photos: 0,
    ...extra,
  });

  test("no quote given: one photo, and a quote written in her voice on the subject she named", () => {
    const result = quotePhotoFromReading(quoteReading("make me a quote post about preparing for the new year"));
    assert.ok(result && result.kind === "run");
    const request = result.request;
    assert.equal(request.kind, "photos");
    assert.equal(request.count, 1);
    assert.equal(request.mode, "one");
    assert.equal(request.words, undefined);
    assert.equal(request.wordsBrief, "A quote about preparing for the new year.", "the writer is told what the quote is about, not the picture");
    assert.match(request.brief, /fresh notebook/, "the planner is told the picture");
    assert.match(request.brief, /no writing on it/);
    assert.equal(result.reply, QUOTE_PHOTO_WRITE_REPLY);
    assert.deepEqual(stepsFor(request), ["plan", "photos", "words"]);
    assert.equal(agentCredits(request), PHOTO, "one photo's credits, the words free");
    assert.equal(agentNoun(request), "photo with words");
    assert.ok(photoWithWords(request));
  });

  test("her quote, typed in quotes: exactly those words on one photo that suits them", () => {
    const message = `add this quote: "${NEW_YEAR}"`;
    const result = quotePhotoFromReading(quoteReading(message, { words: NEW_YEAR.toLowerCase() }));
    assert.ok(result && result.kind === "run");
    assert.equal(result.request.words, NEW_YEAR, "her words as typed, not the reader's copy");
    assert.equal(result.request.wordsBrief, undefined);
    assert.equal(result.request.count, 1);
    assert.ok(result.request.brief.includes(NEW_YEAR), "the scene planner sees the quote");
    assert.equal(result.reply, QUOTE_PHOTO_REPLY);
    assert.equal(agentCredits(result.request), PHOTO);
  });

  test("the reader calling it words on a photo with nothing attached still makes the photo, unless she points at a photo of hers", () => {
    const message = `put this quote on a photo: "${NEW_YEAR}"`;
    const result = quotePhotoFromReading(quoteReading(message, { kind: "text_photo", quote: false }));
    assert.ok(result && result.kind === "run");
    assert.equal(result.request.words, NEW_YEAR);
    // "this photo" is hers, forgotten: asked for, not replaced by a new one.
    assert.equal(quotePhotoFromReading(quoteReading(`add "${NEW_YEAR}" to this photo`, { kind: "text_photo", quote: false })), null);
    assert.deepEqual(textPhotoFromReading({ message: `add "${NEW_YEAR}" to this photo`, kind: "text_photo", words: NEW_YEAR, brief: "", style: "boxed", screenshots: 0, photos: 0 }), { kind: "chat", reply: TEXT_PHOTO_NEEDS_PHOTO });
  });

  test("a photo of hers attached is words on her photo, free, as before", () => {
    assert.equal(quotePhotoFromReading(quoteReading(`add this quote: "${NEW_YEAR}"`, { photos: 1 })), null);
    const onHers = textPhotoFromReading({ message: `add this quote: "${NEW_YEAR}"`, kind: "text_photo", words: NEW_YEAR, brief: "", style: "boxed", screenshots: 0, photos: 1 });
    assert.ok(onHers && onHers.kind === "run");
    assert.equal(onHers.request.kind, "text_photo");
    assert.equal(agentCredits(onHers.request), 0);
  });

  test("a carousel she asked for, and plain photos, stay what the reader said", () => {
    assert.equal(quotePhotoFromReading(quoteReading("make a carousel of quotes about the new year", { kind: "carousel" })), null);
    assert.equal(quotePhotoFromReading(quoteReading("a four quadrant carousel about my morning", { kind: "carousel", quote: false })), null);
    assert.equal(quotePhotoFromReading(quoteReading("three photos at a cafe", { quote: false })), null);
  });

  test("\"add this quote\" with no quote anywhere asks for it rather than inventing one", () => {
    assert.deepEqual(quotePhotoFromReading(quoteReading("add this quote")), { kind: "chat", reply: TEXT_PHOTO_NEEDS_WORDS });
  });

  test("the look of the words follows the pickers and her words, as on any photo with words", () => {
    const result = quotePhotoFromReading(quoteReading("a lowercase quote post about rest"));
    assert.ok(result && result.kind === "run");
    const picked = withOptions(withTextLook(result.request, { lowercase: true }), { style: "serif" });
    assert.ok(picked.kind === "photos");
    assert.equal(picked.style, "serif");
    assert.equal(picked.lowercase, true);
  });

  test("the reply says the price from the price list, for the image model she picked", () => {
    const result = quotePhotoFromReading(quoteReading("make me a quote post about preparing for the new year"));
    assert.ok(result && result.kind === "run");
    assert.equal(withPhotoPrice(result.request, result.reply), `${QUOTE_PHOTO_WRITE_REPLY} It costs ${PHOTO === 1 ? "1 credit" : `${PHOTO} credits`} for the photo; the words are free.`);
    assert.equal(withPhotoPrice({ kind: "photos", brief: "a cafe", count: 2, mode: "set" }, "Making the photos."), "Making the photos.", "no words, no change");
  });

  test("the scene brief carries the quote once and asks for no writing in the picture", () => {
    const once = sceneForQuote("She sits by a window.", "rest is\nproductive");
    assert.equal(sceneForQuote(once, "rest is\nproductive"), once);
    assert.match(once, /“rest is productive”/);
    assert.match(once, /no writing on it/);
  });

  test("the reader is told a quote post is one photo and a carousel needs the word", () => {
    const system = readerSystem();
    assert.match(system, /quote post[^\n]*kind "photos", count 1/);
    assert.match(system, /A "post" or a "quote post" alone is not a carousel/);
  });
});

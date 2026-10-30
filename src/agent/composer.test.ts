import assert from "node:assert/strict";
import { test } from "node:test";

import { creditsFor } from "@/billing/pricing";
import { CLIP_MODELS } from "@/content/clip-options";
import { IMAGE_MODELS } from "@/content/image-options";

import { agentCredits } from "./plan";
import {
  askOptions,
  choiceMemory,
  CLIP_NOT_A_SLIDE,
  creditsLine,
  DEFAULT_CHOICE,
  HOOK_NEEDS_CLIP,
  isInstruction,
  modelChipLabel,
  NOTHING_ATTACHED,
  oneLineHook,
  pinnedHookMessage,
  rememberedChoice,
  resolveManualMode,
  TEXT_PHOTO_NEEDS_WORDS_MANUAL,
  shotFor,
  VIDEO_NEEDS_PHOTO,
  withPinnedHook,
  type Attached,
  type ComposerChoice,
} from "./composer";

const nothing = NOTHING_ATTACHED;
const clip: Attached = { photos: [], clip: "clip-1" };
const photo: Attached = { photos: ["photo-1"], clip: null };
const twoPhotos: Attached = { photos: ["photo-1", "photo-2"], clip: null };
const message = (mode: ReturnType<typeof resolveManualMode>) => (mode.mode === "none" ? mode.message : "");

test("nothing attached: words make a photo on Image and a set on Slides; Video asks for a photo", () => {
  assert.deepEqual(resolveManualMode({ tab: "image", attached: nothing, text: " at a cafe " }), { mode: "photo", prompt: "at a cafe", sources: [] });
  assert.deepEqual(resolveManualMode({ tab: "slides", format: "story", attached: nothing, text: "three mistakes" }), { mode: "carousel", topic: "three mistakes", format: "story", photos: [] });
  assert.deepEqual(resolveManualMode({ tab: "video", attached: nothing, text: "she sips" }), { mode: "none", message: VIDEO_NEEDS_PHOTO });
  assert.equal(VIDEO_NEEDS_PHOTO, "Attach a photo to animate, or turn Agent on.");
});

test("photos attached on Image make a new photo drawn from them, at most three", () => {
  assert.deepEqual(resolveManualMode({ tab: "image", attached: twoPhotos, text: "same outfit at a café" }), { mode: "photo", prompt: "same outfit at a café", sources: ["photo-1", "photo-2"] });
  const five: Attached = { photos: ["a", "b", "c", "d", "e"], clip: null };
  const result = resolveManualMode({ tab: "image", attached: five, text: "extend to 16:9" });
  assert.deepEqual(result.mode === "photo" ? result.sources : null, ["a", "b", "c"]);
  assert.equal(resolveManualMode({ tab: "image", attached: photo, text: "" }).mode, "none");
});

test("a photo attached on Video is animated; with several, the first is used and the rest counted", () => {
  assert.deepEqual(resolveManualMode({ tab: "video", attached: photo, text: "she lifts the cup" }), { mode: "clip", mediaId: "photo-1", motion: "she lifts the cup", unused: 0 });
  assert.deepEqual(resolveManualMode({ tab: "video", attached: twoPhotos, text: "she lifts the cup" }), { mode: "clip", mediaId: "photo-1", motion: "she lifts the cup", unused: 1 });
  assert.match(message(resolveManualMode({ tab: "video", attached: photo, text: "" })), /what she does/);
});

test("photos attached on Slides are the set's photos in order, with a pinned hook as the cover", () => {
  assert.deepEqual(resolveManualMode({ tab: "slides", attached: twoPhotos, text: "three mistakes" }), { mode: "carousel", topic: "three mistakes", format: "carousel", photos: ["photo-1", "photo-2"] });
  assert.deepEqual(resolveManualMode({ tab: "slides", attached: twoPhotos, text: "", hook: "Stop filming yourself" }), {
    mode: "carousel", topic: "Stop filming yourself", format: "carousel", photos: ["photo-1", "photo-2"], cover: "Stop filming yourself",
  });
});

test("a clip attached is a reel on Image or Video: the pinned hook, else the typed words", () => {
  assert.deepEqual(resolveManualMode({ tab: "image", attached: clip, text: "I never film myself" }), { mode: "reel", mediaId: "clip-1", hook: "I never film myself", pinned: false });
  assert.equal(resolveManualMode({ tab: "video", attached: clip, text: "I never film myself" }).mode, "reel");
  assert.equal(resolveManualMode({ tab: "video", attached: clip, text: "" }).mode, "none");
  assert.deepEqual(resolveManualMode({ tab: "video", attached: clip, text: "anything typed", hook: " Stop filming yourself " }), { mode: "reel", mediaId: "clip-1", hook: "Stop filming yourself", pinned: true, setAside: "anything typed" });
  // Photos alongside a clip do not change it: the clip is the footage.
  assert.equal(resolveManualMode({ tab: "image", attached: { photos: ["photo-1"], clip: "clip-1" }, text: "words" }).mode, "reel");
});

test("a clip on Slides is refused in words", () => {
  assert.deepEqual(resolveManualMode({ tab: "slides", attached: clip, text: "I never film myself" }), { mode: "none", message: CLIP_NOT_A_SLIDE });
  assert.equal(CLIP_NOT_A_SLIDE, "A clip can't be a slide. Switch to Image or Video to make a reel.");
});

test("a hook alone is refused on Image and Video and is the cover on Slides", () => {
  assert.deepEqual(resolveManualMode({ tab: "image", attached: nothing, text: "at a cafe", hook: "Stop filming yourself" }), { mode: "none", message: HOOK_NEEDS_CLIP });
  assert.deepEqual(resolveManualMode({ tab: "video", attached: nothing, text: "", hook: "Stop filming yourself" }), { mode: "none", message: HOOK_NEEDS_CLIP });
  assert.equal(HOOK_NEEDS_CLIP, "Attach a clip for a reel, or switch to Slides for a carousel.");
  assert.deepEqual(resolveManualMode({ tab: "slides", attached: nothing, text: "", hook: " Stop filming yourself " }), {
    mode: "carousel", topic: "Stop filming yourself", format: "carousel", photos: [], cover: "Stop filming yourself",
  });
  // A long hook gives the set its first line as the topic, and stays whole as the cover.
  const long = `My name is Laura\nI hate filming in public`;
  const result = resolveManualMode({ tab: "slides", attached: nothing, text: "", hook: long });
  assert.equal(result.mode === "carousel" ? result.topic : null, "My name is Laura");
  assert.equal(result.mode === "carousel" ? result.cover : null, long);
});

test("nothing typed and nothing attached asks for words", () => {
  assert.deepEqual(resolveManualMode({ tab: "image", attached: nothing, text: "  " }), { mode: "none", message: "Say what you want made." });
});

test("the credits line prices the manual modes from pricing.ts", () => {
  const image: ComposerChoice = { ...DEFAULT_CHOICE, tab: "image", imageModel: "pro" };
  assert.equal(creditsLine(image, false, nothing), `This will use ${creditsFor({ kind: "image", model: "pro" })} credits`);
  const daily: ComposerChoice = { ...DEFAULT_CHOICE, tab: "image", imageModel: "daily" };
  assert.equal(creditsLine(daily, false, nothing), "This will use 1 credit");
  // A new photo from attached photos is the chosen image model's price.
  assert.equal(creditsLine(image, false, twoPhotos), `This will use ${creditsFor({ kind: "image", model: "pro" })} credits`);

  const video: ComposerChoice = { ...DEFAULT_CHOICE, tab: "video", clipModel: "omni" };
  assert.equal(creditsLine(video, false, photo), `This will use ${creditsFor({ kind: "clip", model: "omni", seconds: 5 })} credits`);

  // A reel from a clip she already has, and a set, cost nothing.
  assert.equal(creditsLine(video, false, clip), "Free");
  assert.equal(creditsLine(image, false, clip), "Free");
  assert.equal(creditsLine({ ...DEFAULT_CHOICE, tab: "slides" }, false, nothing), "Free");
  assert.equal(creditsLine({ ...DEFAULT_CHOICE, tab: "slides" }, false, twoPhotos), "Free");
});

test("the credits line names no price for a mode that will not run", () => {
  const video: ComposerChoice = { ...DEFAULT_CHOICE, tab: "video" };
  assert.equal(creditsLine(video, false, nothing), VIDEO_NEEDS_PHOTO);
  const image: ComposerChoice = { ...DEFAULT_CHOICE, tab: "image" };
  assert.equal(creditsLine(image, false, nothing, "Stop filming yourself"), HOOK_NEEDS_CLIP);
  assert.equal(creditsLine({ ...DEFAULT_CHOICE, tab: "slides" }, false, clip), CLIP_NOT_A_SLIDE);
  assert.doesNotMatch(creditsLine(video, false, nothing), /credit/);
});

test("with the agent on, attached footage lowers the reel's price", () => {
  const choice: ComposerChoice = { ...DEFAULT_CHOICE, clipModel: "omni", clipModelPicked: true };
  assert.equal(creditsLine(choice, true, clip), "The agent decides what to make. A reel on your clip is free.");
  const clipOnly = agentCredits({ kind: "reel", brief: "", footage: "auto", cue: "auto", talking: false, clipModel: "omni", material: { photos: ["photo-1"] } });
  assert.equal(creditsLine(choice, true, photo), `The agent decides what to make. A reel from your photo is up to ${clipOnly} credits.`);
});

test("with the agent on the line gives the reel's ceiling from the run estimate", () => {
  const choice: ComposerChoice = { ...DEFAULT_CHOICE, imageModel: "pro", clipModel: "omni", clipModelPicked: true };
  const ceiling = agentCredits({ kind: "reel", brief: "", footage: "auto", cue: "auto", talking: false, model: "pro", clipModel: "omni" });
  assert.equal(creditsLine(choice, true, nothing), `The agent decides what to make. A reel is up to ${ceiling} credits.`);
  // Unpicked, the run may make a talking reel, so the ceiling covers it.
  const auto: ComposerChoice = { ...DEFAULT_CHOICE, imageModel: "pro" };
  const talking = agentCredits({ kind: "reel", brief: "", footage: "auto", cue: "auto", talking: true, model: "pro" });
  assert.equal(creditsLine(auto, true, nothing), `The agent decides what to make. A reel is up to ${Math.max(ceiling, talking)} credits.`);
});

test("the agent is sent only the video model and format she picked", () => {
  const sent = askOptions(DEFAULT_CHOICE);
  assert.equal(sent.clipModel, undefined);
  assert.equal(sent.format, undefined);
  assert.equal(sent.style, DEFAULT_CHOICE.textStyle);
  const picked = askOptions({ ...DEFAULT_CHOICE, clipModel: "omni", clipModelPicked: true, format: "story", formatPicked: true });
  assert.equal(picked.clipModel, "omni");
  assert.equal(picked.format, "story");
});

test("the model chip names the model and the shape, or the slides format", () => {
  assert.equal(modelChipLabel({ ...DEFAULT_CHOICE, tab: "image", imageModel: "daily", imageAspect: "4:5" }), `${IMAGE_MODELS.daily.label} · 4:5`);
  const kling = CLIP_MODELS.find((model) => model.id === "omni");
  assert.equal(modelChipLabel({ ...DEFAULT_CHOICE, tab: "video", clipModel: "omni", clipAspect: "9:16" }), `${kling?.name} · 9:16`);
  assert.equal(modelChipLabel({ ...DEFAULT_CHOICE, tab: "slides", format: "carousel" }), "Carousel");
  assert.equal(modelChipLabel({ ...DEFAULT_CHOICE, tab: "slides", format: "story" }), "Story");
  // With the agent on, what she has not picked reads as the agent's choice.
  assert.equal(modelChipLabel({ ...DEFAULT_CHOICE, tab: "video" }, true), "Video · Auto");
  assert.equal(modelChipLabel({ ...DEFAULT_CHOICE, tab: "video", clipModelPicked: true }, true), `${kling?.name} · 9:16`);
  assert.equal(modelChipLabel({ ...DEFAULT_CHOICE, tab: "slides" }, true), "Slides · Auto");
  assert.equal(modelChipLabel({ ...DEFAULT_CHOICE, tab: "slides", format: "story", formatPicked: true }, true), "Story");
});

test("the shot is read off the words, a friend's camera otherwise", () => {
  assert.equal(shotFor("a mirror selfie in the hallway"), "mirror");
  assert.equal(shotFor("a 0.5 selfie at the beach"), "wide_selfie");
  assert.equal(shotFor("a selfie in the car"), "selfie");
  assert.equal(shotFor("walking through the market"), "friend");
});

test("a pinned hook reaches the agent on the exact-words path, ahead of what she typed", () => {
  assert.equal(pinnedHookMessage(" Stop filming yourself "), 'Use this exact hook: "Stop filming yourself"');
  assert.equal(withPinnedHook("make it a reel", " Stop filming yourself "), 'Use this exact hook: "Stop filming yourself" make it a reel');
  assert.equal(withPinnedHook("", "Stop filming yourself"), 'Use this exact hook: "Stop filming yourself"');
  assert.equal(withPinnedHook("make a reel", null), "make a reel");
});

const LONG_HOOK = Array.from({ length: 57 }, (_, index) => `word${index}`).join(" ");

test("a long pinned hook on a clip is the reel's words, whatever the reel's word limit", () => {
  const result = resolveManualMode({ tab: "image", attached: clip, text: "make reel", hook: LONG_HOOK });
  assert.deepEqual(result, { mode: "reel", mediaId: "clip-1", hook: LONG_HOOK, pinned: true });
  assert.equal(creditsLine(DEFAULT_CHOICE, false, clip, LONG_HOOK), "Free");
});

test("typed words that only say go are set aside beside a pinned hook; real words are set aside and said so", () => {
  for (const said of ["make reel", "Make a reel", "go", "do it!", "ok make it", "create the video", ""]) assert.ok(isInstruction(said), said);
  for (const said of ["I never film myself", "why nobody sees my face", "make money while you sleep with an avatar that posts for you"]) assert.ok(!isInstruction(said), said);
  const words = resolveManualMode({ tab: "video", attached: clip, text: "I never film myself", hook: "Stop filming yourself" });
  assert.deepEqual(words, { mode: "reel", mediaId: "clip-1", hook: "Stop filming yourself", pinned: true, setAside: "I never film myself" });
  // On Slides an instruction is not a topic: the hook gives it.
  const set = resolveManualMode({ tab: "slides", attached: nothing, text: "make carousel", hook: "Stop filming yourself" });
  assert.equal(set.mode === "carousel" ? set.topic : null, "Stop filming yourself");
});

test("a hook written in lines reads on one line in the chip", () => {
  assert.equal(oneLineHook("I am begging you\n1. Start a new account.\n\n2. Block everyone."), "I am begging you / 1. Start a new account. / 2. Block everyone.");
});

test("one photo on Slides with words: her words drawn on that photo, exactly, free", () => {
  const words = "this era is called:\nmoving like i should have been a long time ago & never looking back.";
  assert.deepEqual(resolveManualMode({ tab: "slides", attached: photo, text: `  ${words}  ` }), { mode: "text_photo", mediaId: "photo-1", words, pinned: false });
  assert.deepEqual(resolveManualMode({ tab: "slides", attached: photo, text: "" }), { mode: "none", message: TEXT_PHOTO_NEEDS_WORDS_MANUAL });
  assert.equal(creditsLine({ ...DEFAULT_CHOICE, tab: "slides" }, false, photo), "Free");
});

test("one photo on Slides with a pinned hook: the hook is the words, what she typed is set aside", () => {
  assert.deepEqual(resolveManualMode({ tab: "slides", attached: photo, text: "make it", hook: "Stop filming yourself" }), {
    mode: "text_photo",
    mediaId: "photo-1",
    words: "Stop filming yourself",
    pinned: true,
  });
  const aside = resolveManualMode({ tab: "slides", attached: photo, text: "something else entirely here", hook: "Stop filming yourself" });
  assert.equal(aside.mode === "text_photo" && aside.setAside, "something else entirely here");
});

test("two or more photos on Slides stay a set of exactly those photos", () => {
  assert.equal(resolveManualMode({ tab: "slides", attached: twoPhotos, text: "three mistakes" }).mode, "carousel");
});

test("with the agent on, the Slides tab and a picked shape travel with the message", () => {
  assert.equal(askOptions({ ...DEFAULT_CHOICE, tab: "slides" }).slides, true);
  assert.equal(askOptions(DEFAULT_CHOICE).slides, undefined);
  assert.equal(askOptions(DEFAULT_CHOICE).aspectPicked, undefined);
  assert.equal(askOptions({ ...DEFAULT_CHOICE, imageAspectPicked: true }).aspectPicked, true);
  assert.equal(creditsLine({ ...DEFAULT_CHOICE, tab: "slides" }, true, photo), "The agent decides what to make. Words on your photo are free.");
});

test("the composer remembers models, shape, style and format across visits, but only what she picked", () => {
  const picked = { ...DEFAULT_CHOICE, tab: "video" as const, imageModel: "pro" as const, imageAspect: "9:16" as const, imageAspectPicked: true, textStyle: "serif" as const, clipModel: "omni" as const, clipModelPicked: true, format: "story" as const, formatPicked: true };
  const back = rememberedChoice(choiceMemory(picked), DEFAULT_CHOICE);
  assert.deepEqual(back, { ...picked, tab: DEFAULT_CHOICE.tab }, "every picker back, the tab left alone");
  const untouched = rememberedChoice(choiceMemory({ ...DEFAULT_CHOICE, imageModel: "pro" }), DEFAULT_CHOICE);
  assert.equal(untouched.clipModelPicked, false, "an unpicked video model is not pinned");
  assert.equal(untouched.formatPicked, false);
  assert.equal(untouched.imageAspectPicked, false);
  assert.equal(untouched.imageModel, "pro");
  assert.ok(!("agentOn" in JSON.parse(choiceMemory(picked))), "the Agent toggle is not kept");
});

test("a missing, broken or stale memory gives the defaults", () => {
  assert.deepEqual(rememberedChoice(null, DEFAULT_CHOICE), DEFAULT_CHOICE);
  assert.deepEqual(rememberedChoice("{not json", DEFAULT_CHOICE), DEFAULT_CHOICE);
  assert.deepEqual(rememberedChoice("[]", DEFAULT_CHOICE), DEFAULT_CHOICE);
  assert.deepEqual(rememberedChoice(JSON.stringify({ imageModel: "ultra", textStyle: "comic", clipModel: "veo", format: "reel", imageAspect: "2:1" }), DEFAULT_CHOICE), DEFAULT_CHOICE);
});

test("size and case go with a message only once she set them, and come back on the next visit", () => {
  assert.equal(askOptions(DEFAULT_CHOICE).size, undefined);
  assert.equal(askOptions(DEFAULT_CHOICE).lowercase, undefined);
  const picked = { ...DEFAULT_CHOICE, textSize: "small" as const, textSizePicked: true, lowercase: true, lowercasePicked: true };
  assert.equal(askOptions(picked).size, "small");
  assert.equal(askOptions(picked).lowercase, true);
  const back = rememberedChoice(choiceMemory(picked), DEFAULT_CHOICE);
  assert.equal(back.textSize, "small");
  assert.equal(back.lowercase, true);
  assert.equal(back.textSizePicked, true);
  // Never set: nothing remembered, so her words can still ask.
  const plain = rememberedChoice(choiceMemory(DEFAULT_CHOICE), DEFAULT_CHOICE);
  assert.equal(plain.textSizePicked, false);
  assert.equal(plain.lowercasePicked, false);
  // A hand-edited value falls back to the default.
  assert.equal(rememberedChoice(JSON.stringify({ textSize: "huge", lowercase: "yes" }), DEFAULT_CHOICE).textSize, "large");
});

test("the slides chip names a layout only once one other than photos and text is picked", () => {
  const slides = { ...DEFAULT_CHOICE, tab: "slides" as const };
  assert.equal(modelChipLabel(slides, true), "Slides · Auto");
  assert.equal(modelChipLabel({ ...slides, layout: "split", layoutPicked: true }, true), "Slides · Half and half");
  assert.equal(modelChipLabel({ ...slides, layout: "grid", layoutPicked: true, formatPicked: true }, true), "Carousel · Four-photo cover");
  assert.equal(modelChipLabel({ ...slides, layout: "mixed", layoutPicked: true }, false), "Carousel");
});

test("a picked layout is remembered and sent; an unpicked one is neither", () => {
  assert.equal(askOptions(DEFAULT_CHOICE).layout, undefined);
  assert.equal(askOptions({ ...DEFAULT_CHOICE, layout: "split", layoutPicked: true }).layout, "split");
  const back = rememberedChoice(choiceMemory({ ...DEFAULT_CHOICE, layout: "grid", layoutPicked: true }), DEFAULT_CHOICE);
  assert.equal(back.layout, "grid");
  assert.equal(back.layoutPicked, true);
  assert.equal(rememberedChoice(JSON.stringify({ layout: "collage" }), DEFAULT_CHOICE).layoutPicked, false);
});

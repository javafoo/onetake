import assert from "node:assert/strict";
import { test } from "node:test";

import { agentCredits, agentNoun, initialState, remainingCredits, STEPS_FOR, type AgentRequest } from "./plan";
import { slidesMeansTextPhoto, withMaterial, withOptions } from "./options";
import {
  asksForTextOnPhoto,
  quotedWords,
  TEXT_PHOTO_NEEDS_PHOTO,
  TEXT_PHOTO_NEEDS_WORDS,
  textPhotoFromReading,
  wordsForTextPhoto,
  unwrapScreenshotLines,
  pointsAtMissingWords,
  TEXT_PHOTO_WRITE_REPLY,
} from "./text-photo";

const QUOTE = "this era is called: moving like i should have been a long time ago & never looking back.";
const reading = (patch: Partial<Parameters<typeof textPhotoFromReading>[0]>) => ({
  message: "add this quote to this photo",
  kind: "photos",
  words: "",
  brief: "",
  style: "serif",
  screenshots: 0,
  photos: 1,
  ...patch,
});

test("asks for words on a photo: the founder's words and the usual ways of saying it", () => {
  for (const message of ["add this quote to this photo", "put this on the photo", "write “no days off” on it", "Overlay the text on my picture", "add the caption onto this pic"]) {
    assert.equal(asksForTextOnPhoto(message), true, message);
  }
});

test("a thing in the scene, or a new photo, is not words on a photo", () => {
  for (const message of ["put a hat on her", "put her on the beach", "three photos at a cafe", "make me a reel about my morning", "add a latte to the table"]) {
    assert.equal(asksForTextOnPhoto(message), false, message);
  }
});

test("quoted words are taken exactly as typed, the longest quotation first", () => {
  assert.equal(quotedWords('put "Soft Life, Hard Work" on this photo'), "Soft Life, Hard Work");
  assert.equal(quotedWords("write “ok” then “this Era Is Mine” on it"), "this Era Is Mine");
  assert.equal(quotedWords("add this quote to this photo"), null);
});

test("words typed after the ask keep her case and line breaks, even if the reader changed them", () => {
  const message = "write This Is My\nEra on it";
  assert.equal(wordsForTextPhoto(message, "this is my era", false), "This Is My\nEra");
});

test("with no words in the message, the words read off her screenshot are used, all of them", () => {
  assert.equal(wordsForTextPhoto("add this quote to this photo", QUOTE, true), QUOTE);
  // Without a screenshot, words the reader made up are not hers: ask instead.
  assert.equal(wordsForTextPhoto("add this quote to this photo", QUOTE, false), null);
  assert.equal(wordsForTextPhoto("add this quote to this photo", "", true), null);
});

test("the founder's case: a photo classed as a new photo becomes words on her photo, free", () => {
  const result = textPhotoFromReading(reading({ kind: "photos", words: QUOTE, screenshots: 1 }));
  assert.ok(result && result.kind === "run");
  assert.equal(result.request.kind, "text_photo");
  assert.equal(result.request.words, QUOTE, "every word, untouched");
  assert.equal(result.request.style, "serif");
  assert.equal(agentCredits(result.request), 0);
});

test("no photo attached: it asks for one with +, and never makes a new photo", () => {
  assert.deepEqual(textPhotoFromReading(reading({ kind: "text_photo", words: QUOTE, screenshots: 1, photos: 0 })), { kind: "chat", reply: TEXT_PHOTO_NEEDS_PHOTO });
  // Without a photo, a plain ask the reader read as something else is left to the reader.
  assert.equal(textPhotoFromReading(reading({ kind: "photos", photos: 0 })), null);
});

test("no words anywhere: it asks for them in a chat reply", () => {
  assert.deepEqual(textPhotoFromReading(reading({ kind: "text_photo" })), { kind: "chat", reply: TEXT_PHOTO_NEEDS_WORDS });
});

test("words she describes rather than gives are written for her: the founder's failed case, first time", () => {
  const message = "add a trending motivational and relatable slightly unhinged life quote to this photo";
  const brief = "Add a trending, relatable, slightly unhinged motivational life quote to her photo.";
  const result = textPhotoFromReading(reading({ kind: "text_photo", message, brief }));
  assert.equal(result?.kind, "run");
  if (result?.kind === "run") {
    assert.equal(result.request.words, "");
    assert.equal(result.request.wordsBrief, brief);
    assert.equal(result.reply, TEXT_PHOTO_WRITE_REPLY);
  }
  // Even when the reader called it something else, her plain ask with a photo attached is words on it.
  assert.equal(textPhotoFromReading(reading({ kind: "photos", message, brief }))?.kind, "run");
});

test("words she points at but did not give are asked for, not invented", () => {
  for (const message of ["add this quote to this photo", "put my caption on the photo", "add the following text to it"]) {
    assert.ok(pointsAtMissingWords(message), message);
    assert.deepEqual(textPhotoFromReading(reading({ kind: "text_photo", message })), { kind: "chat", reply: TEXT_PHOTO_NEEDS_WORDS });
  }
  assert.ok(!pointsAtMissingWords("add a motivational quote to this photo"));
});

test("“can you write them for me” after our question continues her first ask, with its description", () => {
  const first = "add a trending motivational and relatable slightly unhinged life quote to this photo";
  const lastChat = { message: first, reply: TEXT_PHOTO_NEEDS_WORDS };
  for (const message of ["can you write them for me", "you pick", "up to you", "just make something up"]) {
    const result = textPhotoFromReading(reading({ kind: "chat", message, lastChat }));
    assert.equal(result?.kind, "run", message);
    if (result?.kind === "run") assert.equal(result.request.wordsBrief, first);
  }
  // Only as an answer to that question, and only with her photo still attached.
  assert.equal(textPhotoFromReading(reading({ kind: "chat", message: "can you write them for me", lastChat: { message: first, reply: "Sure." } })), null);
  assert.equal(textPhotoFromReading(reading({ kind: "chat", message: "can you write them for me", lastChat, photos: 0 })), null);
});

test("a chat answer from the reader is not overridden, and other requests pass through", () => {
  assert.equal(textPhotoFromReading(reading({ kind: "chat" })), null);
  assert.equal(textPhotoFromReading(reading({ kind: "reel", message: "make me a reel about mornings" })), null);
});

const TEXT_PHOTO: AgentRequest = { kind: "text_photo", brief: "the quote on her photo", words: QUOTE, material: { photos: ["p1"] } };

test("the plan: one step, free, and nothing left to charge on a retry", () => {
  assert.deepEqual(STEPS_FOR.text_photo, ["words"]);
  assert.equal(agentCredits(TEXT_PHOTO), 0);
  assert.equal(remainingCredits(TEXT_PHOTO, initialState(TEXT_PHOTO)), 0);
  assert.equal(agentNoun(TEXT_PHOTO), "photo with words");
});

test("the pickers: the text style always, the shape only when she picked it", () => {
  const plain = withOptions(TEXT_PHOTO, { style: "pastel", imageAspect: "1:1" });
  assert.equal(plain.kind === "text_photo" && plain.style, "pastel");
  assert.equal(plain.kind === "text_photo" && plain.aspect, undefined, "the photo's own shape");
  const cut = withOptions(TEXT_PHOTO, { style: "bold", imageAspect: "1:1", aspectPicked: true });
  assert.equal(cut.kind === "text_photo" && cut.aspect, "1:1");
});

test("words on a photo without her photo is refused, not made on a new one", () => {
  assert.throws(() => withMaterial({ ...TEXT_PHOTO, material: undefined }, null), { message: TEXT_PHOTO_NEEDS_PHOTO });
  const kept = withMaterial({ ...TEXT_PHOTO, material: undefined }, { photos: ["mine"], clip: "c1" });
  assert.deepEqual(kept.kind === "text_photo" && kept.material, { photos: ["mine"] });
});

test("Slides chosen, one photo and words: a request read as new photos is words on that photo", () => {
  const photos: AgentRequest = { kind: "photos", brief: "her photo with the quote", count: 1, mode: "one", material: { photos: ["p1"] } };
  const turned = slidesMeansTextPhoto(photos, { slides: true }, QUOTE);
  assert.equal(turned.request.kind, "text_photo");
  assert.equal(turned.request.kind === "text_photo" && turned.request.words, QUOTE);
  assert.ok(turned.reply);
  // Narrow: not without Slides, not without words, not with two photos, not for other kinds.
  assert.equal(slidesMeansTextPhoto(photos, {}, QUOTE).request, photos);
  assert.equal(slidesMeansTextPhoto(photos, { slides: true }, undefined).request, photos);
  const two: AgentRequest = { ...photos, material: { photos: ["p1", "p2"] } };
  assert.equal(slidesMeansTextPhoto(two, { slides: true }, QUOTE).request, two);
  const set: AgentRequest = { kind: "carousel", brief: "x", format: "carousel", material: { photos: ["p1"] } };
  assert.equal(slidesMeansTextPhoto(set, { slides: true }, QUOTE).request, set);
});

test("a screenshot's own wrapping is joined, its separate blocks kept", () => {
  assert.equal(
    unwrapScreenshotLines("this era is called: moving like i\nshould have been a long time\nago & never looking back."),
    "this era is called: moving like i should have been a long time ago & never looking back.",
  );
  assert.equal(unwrapScreenshotLines("Line one\nstill one\n\nBlock two"), "Line one still one\n\nBlock two");
});

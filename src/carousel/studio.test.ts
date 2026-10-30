import assert from "node:assert/strict";
import { test } from "node:test";

import { editCaption, editSlide, plainProblem, setSlidePhoto, slideEmphasis, titleLinesFrom, titleLinesText } from "./edit";
import { listKits } from "./kits";
import { coverFits, coverLinesFrom, coverPartsFrom, openingParts, slidePlan, splitCover, withCoverTitle } from "./write";
import { kitOwnerSlug } from "./owners";
import { autoPickPhotos, carouselName, photoMap, photosNeeded, slugify, type PhotoCandidate } from "./pick";
import { parseSpec, type CarouselSpec } from "./spec";
import { crc32, zip } from "./zip";

/* The app layer's own logic, with no network, no canvas and no database: what
   a creator may choose from, which photos she gets when she chooses none, and
   what happens to a spec when she rewrites a slide. */

function spec(): CarouselSpec {
  return parseSpec({
    name: "test-set",
    format: "carousel",
    caption: "Comment AVATAR and I will send the guide.",
    slides: [
      { type: "cover", photo: "p00", title: { lines: ["I grew this", "to *285K*"], accent: "without my face." }, sub: "One line." },
      { type: "paper", title: { lines: ["The camera", "was never", "the problem"] }, body: "I had the ideas, I just did not want to be on camera." },
      { type: "paper", title: { lines: ["So I built", "*her*"] }, body: "She shows up every day with my voice." },
      { type: "cover", photo: "p01", title: { lines: ["Every single", "day"] } },
      { type: "keyword", keyword: "AVATAR", promise: "Comment it and I will send the guide." },
    ],
  });
}

/* --- who may use a private kit ------------------------------------------- */

test("no account owns a private kit, so everyone sees the five text-style looks", () => {
  assert.equal(kitOwnerSlug("user_someone_else"), undefined);
  assert.equal(kitOwnerSlug(""), undefined);
  assert.ok(!listKits(kitOwnerSlug("user_someone_else")).some((kit) => kit.private));
  assert.deepEqual(listKits(kitOwnerSlug("user_someone_else")).map((kit) => kit.id), ["bold", "pastel", "boxed", "serif", "serif_boxed"]);
});

test("a spoofed owner slug cannot be reached through the ownership rule", () => {
  // The rule only ever answers from the table.
  for (const attempt of ["owner", "user_owner", "__proto__", "constructor"]) {
    assert.equal(kitOwnerSlug(attempt), undefined, attempt);
  }
});

/* --- picking photos when she picks none ---------------------------------- */

const candidate = (id: string, kind: PhotoCandidate["kind"], day: number): PhotoCandidate => ({
  id,
  kind,
  createdAt: Date.UTC(2026, 8, day),
});

test("the automatic pick prefers her own photos, newest first", () => {
  const picked = autoPickPhotos(
    [
      candidate("ref-old", "reference", 1),
      candidate("img-old", "image", 2),
      candidate("img-new", "image", 9),
      candidate("ref-new", "reference", 10),
    ],
    2,
  );
  assert.equal(picked.length, 2);
  assert.ok(picked.includes("img-new"), "the newest library photo is always in");
  assert.ok(!picked.includes("ref-new"), "a reference is only used once the library runs out");
});

test("the automatic pick falls back to references, and to nothing at all", () => {
  const onlyRefs = autoPickPhotos([candidate("a", "reference", 1), candidate("b", "reference", 2)], 3);
  assert.deepEqual([...onlyRefs].sort(), ["a", "b"]);
  assert.deepEqual(autoPickPhotos([], 3), []);
  assert.deepEqual(autoPickPhotos([candidate("a", "image", 1)], 0), []);
});

test("the pick spreads the pool instead of walking it in order", () => {
  const pool = Array.from({ length: 9 }, (_, index) => candidate(`p${index}`, "image", index + 1));
  const picked = autoPickPhotos(pool, 3);
  assert.equal(new Set(picked).size, 3, "no photo is used twice");
  // Newest first, then spread: the second pick is not simply the next one down.
  assert.notEqual(picked[1], "p7");
});

test("a story needs fewer photos than a carousel, and refs are numbered from zero", () => {
  assert.equal(photosNeeded("carousel"), 3);
  assert.equal(photosNeeded("story"), 2);
  assert.deepEqual(photoMap(["a", "b"]), { p00: "a", p01: "b" });
});

test("the spec name is always a legal slug", () => {
  assert.equal(carouselName("Why batching beats posting daily", "signal", "carousel"), "why-batching-beats-posting-daily-signal");
  assert.equal(carouselName("  ...  ", "atelier", "story"), "carousel-atelier-story");
  assert.match(carouselName("A".repeat(200), "notebook", "carousel"), /^[a-z0-9][a-z0-9-]{1,48}$/);
  assert.equal(slugify("Emoji 🎉 and — dashes"), "emoji-and-dashes");
});

/* --- editing a slide ------------------------------------------------------ */

test("a title is edited as lines of text, and emphasis survives the round trip", () => {
  const before = spec();
  assert.equal(titleLinesText(before.slides[0]), "I grew this\nto *285K*");
  assert.deepEqual(slideEmphasis(before.slides[0]), ["285K"]);
  assert.deepEqual(titleLinesFrom("  one  \n\n two \n"), ["one", "two"]);

  const after = editSlide(before, 0, { titleLines: ["I grew *this*", "with no face"] });
  assert.deepEqual(after.slides[0].type === "cover" ? after.slides[0].title.lines : [], ["I grew *this*", "with no face"]);
  assert.deepEqual(slideEmphasis(after.slides[0]), ["this"]);
  // Everything else on the slide, and every other slide, is untouched.
  assert.equal(after.slides[0].type === "cover" ? after.slides[0].photo : null, "p00");
  assert.deepEqual(after.slides.slice(1), before.slides.slice(1));
});

test("an accent line and a sub are cleared by emptying them, not by omitting them", () => {
  const cleared = editSlide(spec(), 0, { accent: "  ", sub: "" });
  const cover = cleared.slides[0];
  assert.equal(cover.type === "cover" ? cover.title.accent : "x", undefined);
  assert.equal(cover.type === "cover" ? cover.sub : "x", undefined);

  // Omitting the field leaves what was there.
  const kept = editSlide(spec(), 0, { titleLines: ["Still here"] });
  assert.equal(kept.slides[0].type === "cover" ? kept.slides[0].title.accent : null, "without my face.");
});

test("an edit that would break a slide is refused, and changes nothing", () => {
  assert.throws(() => editSlide(spec(), 1, { body: "  " }), /one plain sentence/);
  assert.throws(() => editSlide(spec(), 0, { titleLines: [] }), /lines/i);
  assert.throws(() => editSlide(spec(), 0, { titleLines: ["half *open"] }), /unclosed/);
  assert.throws(() => editSlide(spec(), 9, { body: "nope" }), /not in this set/);
});

test("the paper slide's sentence and the keyword slide's words can be replaced", () => {
  const paper = editSlide(spec(), 1, { body: "  She posts   while I sleep.  " });
  assert.equal(paper.slides[1].type === "paper" ? paper.slides[1].body : null, "She posts while I sleep.");

  const keyword = editSlide(spec(), 4, { keyword: "ENGINE", promise: "Comment it for the guide." });
  assert.equal(keyword.slides[4].type === "keyword" ? keyword.slides[4].keyword : null, "ENGINE");
});

test("a photo can be moved onto a slide that has one, and never onto one that has not", () => {
  const swapped = setSlidePhoto(spec(), 3, "s03");
  assert.equal(swapped.slides[3].type === "cover" ? swapped.slides[3].photo : null, "s03");
  assert.equal(swapped.slides[0].type === "cover" ? swapped.slides[0].photo : null, "p00");
  assert.throws(() => setSlidePhoto(spec(), 1, "s01"), /no photo/);
});

test("the caption is edited to one line", () => {
  assert.equal(editCaption(spec(), "  Comment   AVATAR \n for it. ").caption, "Comment AVATAR for it.");
});

/* --- saying what failed --------------------------------------------------- */

test("a failed check reads as a sentence, with the specifics underneath", () => {
  const plain = plainProblem({ slide: 3, rule: "unsupported-number", detail: '"I made $40,000" uses a number (40,000) that is not in the proof points' });
  assert.equal(plain.where, "Slide 3");
  assert.match(plain.sentence, /not in your proof points/);
  assert.match(plain.detail, /40,000/);

  assert.equal(plainProblem({ slide: null, rule: "caption-one-line", detail: "too long" }).where, "This set");
  // A rule we have no sentence for still says something a person can read.
  assert.match(plainProblem({ slide: 1, rule: "brand-new-rule", detail: "x" }).sentence, /writing rules/);
});

/* --- the zip -------------------------------------------------------------- */

test("a zip has one local header per entry and a directory that points at them", () => {
  const png = Buffer.from("fake png bytes");
  const file = zip([{ name: "01.png", data: png }, { name: "caption.txt", data: Buffer.from("hello") }], new Date(2026, 8, 21, 10, 30));

  assert.equal(file.readUInt32LE(0), 0x04034b50, "starts with a local file header");
  const end = file.length - 22;
  assert.equal(file.readUInt32LE(end), 0x06054b50, "ends with the end-of-directory record");
  assert.equal(file.readUInt16LE(end + 10), 2, "two entries");

  const directoryOffset = file.readUInt32LE(end + 16);
  assert.equal(file.readUInt32LE(directoryOffset), 0x02014b50, "the directory starts where the record says");
  // The first entry's bytes are stored, uncompressed, exactly as handed in.
  const nameLength = file.readUInt16LE(26);
  assert.equal(file.subarray(30, 30 + nameLength).toString(), "01.png");
  assert.deepEqual(file.subarray(30 + nameLength, 30 + nameLength + png.length), png);
  assert.equal(file.readUInt32LE(14), crc32(png));
});

test("crc32 matches the known value for a known string", () => {
  // The standard check value for "123456789".
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test("an empty zip is still a valid, readable, empty zip", () => {
  const file = zip([]);
  assert.equal(file.length, 22);
  assert.equal(file.readUInt32LE(0), 0x06054b50);
  assert.equal(file.readUInt16LE(10), 0);
});

test("a cover the creator wrote is used word for word, split into short lines, whatever the writer did", () => {
  assert.deepEqual(coverLinesFrom("I hate being on camera"), ["I hate being", "on camera"]);
  assert.deepEqual(coverLinesFrom("Nobody at work knows\nI post every day"), ["Nobody at work knows", "I post every day"]);
  assert.equal(coverLinesFrom("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen").length, 4);
  const spec = parseSpec({
    name: "set", caption: "Comment AVATAR.",
    slides: [
      { type: "cover", photo: "p00", title: { lines: ["The writer's", "own words"] }, sub: "Kept." },
      { type: "paper", title: { lines: ["Two"] }, body: "Two." },
      { type: "paper", title: { lines: ["Three"] }, body: "Three." },
      { type: "paper", title: { lines: ["Four"] }, body: "Four." },
      { type: "keyword", keyword: "AVATAR", promise: "The guide." },
    ],
  });
  const fixed = withCoverTitle(spec, "I hate being on camera");
  assert.deepEqual(fixed.slides[0].type === "cover" ? fixed.slides[0].title.lines : [], ["I hate being", "on camera"]);
  assert.equal(fixed.slides[0].type === "cover" ? fixed.slides[0].sub : "", "Kept.");
  assert.equal(withCoverTitle(spec, "   "), spec);
});

test("a longer exact cover is read as headline, sentence and payoff", () => {
  const parts = coverPartsFrom("I hate being on camera. So I sent AI a selfie and asked it to create my images and videos. Here's what I got");
  assert.deepEqual(parts, { title: "I hate being on camera", sub: "So I sent AI a selfie and asked it to create my images and videos.", accent: "Here's what I got" });
  assert.deepEqual(coverPartsFrom("I hate being on camera. So I sent AI a selfie."), { title: "I hate being on camera", sub: "So I sent AI a selfie." });
  assert.deepEqual(coverPartsFrom("I hate being on camera"), { title: "I hate being on camera" });
  assert.deepEqual(coverPartsFrom("Nobody at work knows\n\nI post every day\n\nHere is how"), { title: "Nobody at work knows", sub: "I post every day", accent: "Here is how" });
});

/* --- a long pinned cover runs on into slide 2 ---------------------------- */

const LONG_COVER =
  "Cancel your plans tonight\n\nDo this instead.\n\n-start a new IG page\n-block everyone you know\n-post daily reels\n\nYour life could look completely different 6 months from now.\n\nUse these 7 steps to get started";

const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

test("a long grouped cover breaks at a group, and not one of her words changes", () => {
  assert.equal(coverFits(LONG_COVER), false);
  const { cover, rest } = splitCover(LONG_COVER);
  assert.equal(cover, "Cancel your plans tonight\n\nDo this instead.");
  assert.ok(rest?.startsWith("-start a new IG page"));
  assert.deepEqual([...wordsOf(cover), ...wordsOf(rest ?? "")], wordsOf(LONG_COVER));
});

test("the rest of a long cover opens slide 2, ahead of the writer's pull", () => {
  const written = parseSpec({
    name: "set", caption: "Comment AVATAR.",
    slides: [
      { type: "cover", photo: "p00", title: { lines: ["Cancel your plans", "tonight"] }, sub: "Do this instead." },
      { type: "paper", title: { lines: ["Placeholder", "title"] }, body: "Step one is next →" },
      { type: "paper", title: { lines: ["Three"] }, body: "Three, but why?" },
      { type: "paper", title: { lines: ["Four"] }, body: "Four. Here's how." },
      { type: "keyword", keyword: "AVATAR", promise: "Comment it and I will send the steps." },
    ],
  });
  const fixed = withCoverTitle(written, LONG_COVER);
  const [first, second] = fixed.slides;
  assert.ok(first.type === "cover" && second.type === "paper");
  if (first.type !== "cover" || second.type !== "paper") return;
  // Both groups stay on the cover, at title size; the writer's sub is gone.
  assert.deepEqual(first.title.lines, ["Cancel your plans tonight", "Do this instead."]);
  assert.equal(first.sub, undefined);
  assert.deepEqual(second.title.lines, ["-start a new IG page", "-block everyone you know", "-post daily reels"]);
  assert.equal(second.title.asTyped, true);
  assert.equal(second.body, "Your life could look completely different 6 months from now. Use these 7 steps to get started. Step one is next →");
  const shown = [...first.title.lines, ...second.title.lines, second.body.replace(/\. Step one is next →$/, "")].join(" ");
  assert.deepEqual(wordsOf(shown), wordsOf(LONG_COVER));
  assert.deepEqual(fixed.slides.slice(2), written.slides.slice(2));
});

test("a cover that fits is not split, and slide 2 is left alone", () => {
  assert.deepEqual(splitCover("Nobody at work knows\n\nI post every day\n\nHere is how"), { cover: "Nobody at work knows\n\nI post every day\n\nHere is how" });
  const written = spec();
  const fixed = withCoverTitle(written, "I hate being on camera");
  assert.deepEqual(fixed.slides[1], written.slides[1]);
});

test("a long cover with no groups breaks after a sentence", () => {
  const text = "I hate being on camera. So I sent AI one selfie and asked it for a month of photos and videos. Here is what came back";
  const { cover, rest } = splitCover(text);
  assert.equal(cover, "I hate being on camera.");
  assert.deepEqual([...wordsOf(cover), ...wordsOf(rest ?? "")], wordsOf(text));
  // A title drops the full stop at its end, as a cover title does; the words are hers.
  const bare = (list: string[]) => list.map((word) => word.replace(/[.!?]+$/, ""));
  const opening = openingParts(rest ?? "");
  assert.deepEqual(bare([...opening.lines.flatMap(wordsOf), ...wordsOf(opening.body)]), bare(wordsOf(rest ?? "")));
});

test("a count on her cover sets the number of slides, as far as the format allows", () => {
  // Cover, her opening, seven steps, keyword.
  assert.deepEqual(slidePlan({ format: "carousel", coverTitle: LONG_COVER }), { count: 10, opening: true, promised: { count: 7, noun: "steps" }, capacity: 7 });
  assert.equal(slidePlan({ format: "story", coverTitle: LONG_COVER }).count, 5);
  assert.equal(slidePlan({ format: "carousel", slideCount: 6 }).count, 6);
});

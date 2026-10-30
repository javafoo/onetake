import assert from "node:assert/strict";
import { test } from "node:test";

import { checkSpec, COVER_TITLE_MAX_WORDS, isAction, isPull, isStockPull, moneyLanguage, promisedItems, type CheckSources } from "./check";
import { kitName, listKits, resolveKit } from "./kits";
import { photoRef, resolvePhotoRef, spreadRefs } from "./photos";
import { layoutTitle, placeBand } from "./render";
import { carouselSpecSchema, parseSpec, specProblems, type CarouselSpec } from "./spec";
import { countWords, emphasisWords, parseEmphasis, plainText } from "./text";
import type { BrandProfile } from "../content/hooks";

/* No network: the writer is not exercised here, only the code that decides
   whether what it wrote may ship and how it is laid out. */

const profile: BrandProfile = {
  personaName: "Maya",
  story: "Six months ago my Instagram was dead. I built an avatar and now I post 2-3 times a day.",
  niche: "Building a personal brand with an AI avatar",
  audience: "Women who will not show their face",
  offer: "A beginner guide",
  keyword: "AVATAR",
  voice: "Plain and warm",
  proofPoints: ["This account grew to 285K followers", "Growing 1,000 new followers a day"],
};
const sources: CheckSources = { profile };

function spec(overrides: Partial<CarouselSpec> = {}): CarouselSpec {
  return parseSpec({
    name: "test-set",
    format: "carousel",
    caption: "Comment AVATAR and I will send the guide.",
    slides: [
      { type: "cover", photo: "p00", title: { lines: ["I grew this", "to *285K*"], accent: "without my face." }, sub: "Here's how →" },
      { type: "paper", title: { lines: ["The camera", "was never", "the problem"] }, body: "I had the ideas, but something else stopped me." },
      { type: "paper", title: { lines: ["So I built", "*her*"] }, body: "She shows up every day with my voice. Here's what happened next." },
      { type: "paper", title: { lines: ["1,000 new", "followers"] }, body: "A day, every day. So what changed?" },
      { type: "keyword", keyword: "AVATAR", promise: "Comment it and I will send the guide." },
    ],
    ...overrides,
  });
}

/* --- emphasis parsing ---------------------------------------------------- */

test("emphasis parsing splits runs and keeps the spacing", () => {
  const runs = parseEmphasis("who *pays* the bills");
  assert.deepEqual(runs, [
    { text: "who ", emphasis: false },
    { text: "pays", emphasis: true },
    { text: " the bills", emphasis: false },
  ]);
  assert.equal(plainText("who *pays* the bills"), "who pays the bills");
  assert.equal(countWords("who *pays* the bills"), 4);
});

test("emphasis parsing finds every emphasised word and ignores stray markers", () => {
  assert.deepEqual(emphasisWords("*she* posts *while I sleep*"), ["she", "while", "I", "sleep"]);
  assert.deepEqual(emphasisWords("no emphasis here"), []);
  assert.deepEqual(parseEmphasis("plain line"), [{ text: "plain line", emphasis: false }]);
  // A lone marker is not an emphasis run; it must never swallow the line.
  assert.equal(plainText("half *open"), "half *open");
});

/* --- spec validation ----------------------------------------------------- */

test("a well formed spec parses and keeps its defaults", () => {
  const parsed = spec();
  assert.equal(parsed.version, 1);
  assert.equal(parsed.format, "carousel");
  assert.equal(parsed.slides.length, 5);
});

test("the spec refuses a set that does not end on the keyword slide", () => {
  const problems = specProblems({
    name: "test-set",
    caption: "one line",
    slides: [
      { type: "cover", photo: "p00", title: { lines: ["a"] } },
      { type: "keyword", keyword: "AVATAR", promise: "the guide" },
      { type: "paper", title: { lines: ["b"] }, body: "a sentence" },
    ],
  });
  assert.ok(problems.some((problem) => /keyword slide is the last slide/.test(problem)), problems.join(" | "));
});

test("the spec refuses markup outside a title, unbalanced markers and a bad slug", () => {
  assert.ok(specProblems({ ...spec(), caption: "comment *AVATAR*" }).some((p) => /emphasis/.test(p)));
  assert.ok(
    specProblems({
      ...spec(),
      slides: [{ type: "cover", photo: "p00", title: { lines: ["half *open"] } }, ...spec().slides.slice(1)],
    }).some((p) => /unclosed/.test(p)),
  );
  assert.ok(specProblems({ ...spec(), name: "Not A Slug" }).some((p) => /slug/.test(p)));
});

test("a story is 3 to 5 frames, a carousel 5 to 10", () => {
  const story = { ...spec(), format: "story" as const };
  assert.equal(carouselSpecSchema.safeParse(story).success, true);
  const long = { ...story, slides: [...story.slides.slice(0, 4), ...story.slides] };
  assert.ok(specProblems(long).some((problem) => /frames/.test(problem)), "a 9 frame story should be refused");
});

/* --- checks -------------------------------------------------------------- */

test("a clean set raises no problems", () => {
  assert.deepEqual(checkSpec(spec(), sources), []);
});

test("a cover title over five words is caught", () => {
  const long = spec({
    slides: [
      { type: "cover", photo: "p00", title: { lines: ["I grew this account", "to 285K followers"] } },
      ...spec().slides.slice(1),
    ],
  });
  const problems = checkSpec(long, sources);
  assert.equal(problems[0].rule, "cover-title-length");
  assert.ok(problems[0].detail.includes(String(COVER_TITLE_MAX_WORDS)));
});

test("a title line over four words is caught, on any slide", () => {
  const wide = spec({
    slides: [
      spec().slides[0],
      { type: "paper", title: { lines: ["the camera was never the problem"] }, body: "One sentence, and then?" },
      ...spec().slides.slice(2),
    ],
  });
  const problems = checkSpec(wide, sources);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].rule, "title-line-length");
  assert.equal(problems[0].slide, 2);
});

test("more than two emphasised words in one title is caught", () => {
  const shouty = spec({
    slides: [
      { type: "cover", photo: "p00", title: { lines: ["*I* grew", "*this* *far*"] } },
      ...spec().slides.slice(1),
    ],
  });
  assert.ok(checkSpec(shouty, sources).some((problem) => problem.rule === "emphasis-count"));
});

test("a number that is not in the proof points or the story is caught", () => {
  const invented = spec({
    slides: [
      spec().slides[0],
      { type: "paper", title: { lines: ["I made", "*$40,000*"] }, body: "In a month. But how?" },
      ...spec().slides.slice(2),
    ],
  });
  const problems = checkSpec(invented, sources).filter((problem) => problem.rule === "unsupported-number");
  assert.equal(problems.length, 1);
  assert.ok(problems[0].detail.includes("40,000"));
});

test("a rounded version of a proof number stays traceable", () => {
  const rounded = spec({
    slides: [
      { type: "cover", photo: "p00", title: { lines: ["285,000", "followers"] }, sub: "How?" },
      ...spec().slides.slice(1),
    ],
  });
  assert.deepEqual(checkSpec(rounded, sources), []);
});

test("the keyword slide must carry the profile keyword", () => {
  const wrong = spec({
    slides: [...spec().slides.slice(0, 4), { type: "keyword", keyword: "ENGINE", promise: "the guide" }],
  });
  const problems = checkSpec(wrong, sources);
  assert.equal(problems[0].rule, "keyword-word");
});

test("a caption must be one short line", () => {
  assert.ok(checkSpec(spec({ caption: `Comment AVATAR. ${"word ".repeat(60)}` }), sources).some((p) => p.rule === "caption-one-line"));
});

test("a paper slide holds one sentence, not a paragraph", () => {
  const wordy = spec({
    slides: [
      spec().slides[0],
      { type: "paper", title: { lines: ["Two", "sentences"] }, body: "This is one. This is two." },
      ...spec().slides.slice(2),
    ],
  });
  assert.ok(checkSpec(wordy, sources).some((problem) => problem.rule === "body-one-sentence"));
});

/* --- title fitting ------------------------------------------------------- */

const kit = resolveKit("signal");

test("a long title line shrinks until it fits, and never overflows", () => {
  const box = { maxWidth: 872, maxHeight: 700 };
  const short = layoutTitle(kit, { lines: ["I grew"] }, box);
  const long = layoutTitle(kit, { lines: ["extraordinary transformation"] }, box);
  assert.ok(long.size < short.size, `${long.size} should be under ${short.size}`);
  assert.ok(long.width <= box.maxWidth, `${long.width} over ${box.maxWidth}`);
  assert.ok(long.height <= box.maxHeight);
});

test("every caps line in one title shares a size, set by the widest line", () => {
  const layout = layoutTitle(kit, { lines: ["Short", "a considerably wider line"] }, { maxWidth: 872, maxHeight: 700 });
  const sizes = new Set(layout.lines.filter((line) => line.kind === "caps").map((line) => line.size));
  assert.equal(sizes.size, 1);
  for (const line of layout.lines) assert.ok(line.width <= 872, `${line.width}`);
});

test("a title that cannot fit at the kit minimum still fits the box, and says so", () => {
  const layout = layoutTitle(kit, { lines: ["unconscionable", "incomprehensibility"] }, { maxWidth: 420, maxHeight: 400 });
  assert.equal(layout.fitted, false);
  assert.ok(layout.width <= 420, `${layout.width}`);
  assert.ok(layout.height <= 400, `${layout.height}`);
});

test("a four line title with an accent line stays inside its box", () => {
  const box = { maxWidth: 820, maxHeight: 620 };
  const layout = layoutTitle(
    kit,
    { lines: ["The camera", "was never", "the problem", "for me"], accent: "it was the fear." },
    box,
  );
  assert.equal(layout.lines.length, 5);
  assert.ok(layout.height <= box.maxHeight, `${layout.height}`);
  for (const line of layout.lines) assert.ok(line.width <= box.maxWidth, `${line.width}`);
  // Lines are stacked in order and never sit on top of each other.
  for (let index = 1; index < layout.lines.length; index += 1) {
    assert.ok(layout.lines[index].top >= layout.lines[index - 1].top + layout.lines[index - 1].height);
  }
});

test("every kit lays the same title out without overflowing", () => {
  for (const candidate of [...listKits(), resolveKit("signal"), resolveKit("atelier"), resolveKit("notebook")]) {
    const box = { maxWidth: 1080 - 2 * candidate.margins.side, maxHeight: 640 };
    const layout = layoutTitle(candidate, { lines: ["Posting stopped", "being a *chore*"], accent: "every single day." }, box);
    assert.ok(layout.width <= box.maxWidth, `${candidate.id}: ${layout.width} over ${box.maxWidth}`);
    assert.ok(layout.height <= box.maxHeight, `${candidate.id}: ${layout.height}`);
  }
});

/* --- placement over a photo ---------------------------------------------- */

const safe = { top: 100, bottom: 1200, preferredCentre: 850 };

test("with no face the block sits at the preferred centre", () => {
  assert.deepEqual(placeBand(300, null, safe, 60), { top: 700, reason: "default" });
});

test("a block that would cross the face is pushed under it", () => {
  const placed = placeBand(300, { top: 300, bottom: 760 }, safe, 60);
  assert.equal(placed.reason, "below_face");
  assert.ok(placed.top >= 760);
  assert.ok(placed.top + 300 <= safe.bottom);
});

test("a face low in the frame sends the block above it", () => {
  const placed = placeBand(300, { top: 620, bottom: 1150 }, safe, 60);
  assert.equal(placed.reason, "above_face");
  assert.ok(placed.top + 300 <= 620);
});

test("a face that fills the frame falls back to the lowest safe spot", () => {
  const placed = placeBand(400, { top: 120, bottom: 1100 }, safe, 60);
  assert.equal(placed.reason, "lowest_safe");
  assert.equal(placed.top, safe.bottom - 400);
});

/* --- kits and photos ----------------------------------------------------- */

test("the picker offers the five looks; older kits still resolve", () => {
  assert.deepEqual(listKits().map((entry) => entry.id), ["bold", "pastel", "boxed", "serif", "serif_boxed"]);
  // The older house kits still resolve for rows that carry them, but are not offered.
  assert.equal(resolveKit("signal").id, "signal");
  assert.throws(() => resolveKit("nope"), /Unknown style kit/);
});

test("a customer may retune the palette but not break it", () => {
  const tuned = resolveKit("signal", { palette: { accent: "#0044FF" } });
  assert.equal(tuned.palette.accent, "#0044FF");
  assert.equal(tuned.palette.ink, resolveKit("signal").palette.ink);
  assert.throws(() => resolveKit("signal", { palette: { accent: "blue" } }), /#rrggbb/);
});

test("photo references resolve by index and are spread through the pool", () => {
  const files = ["/a/00.png", "/a/01.png", "/a/02.png"];
  assert.equal(resolvePhotoRef(photoRef(2), files), "/a/02.png");
  assert.throws(() => resolvePhotoRef("p09", files), /out of range/);
  const spread = spreadRefs(["a", "b", "c", "d", "e", "f"]);
  assert.equal(spread.length, 6);
  assert.deepEqual([...spread].sort(), ["a", "b", "c", "d", "e", "f"]);
  assert.notEqual(spread[1], "b"); // neighbours in the folder are not neighbours in the pick order
});

test("a cover the creator wrote is not judged for length, and everything else still is", () => {
  const spec = parseSpec({
    name: "set", caption: "Comment AVATAR.",
    slides: [
      { type: "cover", photo: "p00", title: { lines: ["I hate being on camera so I"] }, sub: "Kept." },
      { type: "paper", title: { lines: ["Two"] }, body: "Two." },
      { type: "paper", title: { lines: ["Three is a longer title line"] }, body: "Three." },
      { type: "paper", title: { lines: ["Four"] }, body: "Four." },
      { type: "keyword", keyword: "AVATAR", promise: "The guide." },
    ],
  });
  const sources = { profile: { niche: "", audience: "", offer: "", keyword: "AVATAR", voice: "", proofPoints: [] } };
  const judged = checkSpec(spec, sources).filter((problem) => problem.slide === 1);
  assert.ok(judged.some((problem) => problem.rule === "cover-title-length"));
  const hers = checkSpec(spec, { ...sources, fixedCover: true });
  assert.ok(!hers.some((problem) => problem.slide === 1 && (problem.rule === "cover-title-length" || problem.rule === "title-line-length")));
  assert.ok(hers.some((problem) => problem.slide === 3 && problem.rule === "title-line-length"), "the writer's own slides are still checked");
});

test("an internal kit still has a name, so old sets do not show a raw id", () => {
  assert.ok(!listKits().some((kit) => kit.id === "signal"));
  assert.equal(kitName("signal"), "Signal");
  assert.equal(kitName("boxed"), "Bold box");
  // An unknown id has no name to show.
  assert.equal(kitName("nope"), null);
});

/* --- the pull: every slide gets her to the next one -------------------- */

test("a set where every slide pulls and the last one asks raises no pull problems", () => {
  const rules = checkSpec(spec(), sources).map((problem) => problem.rule);
  assert.ok(!rules.some((rule) => ["no-pull", "pull-repeated", "pull-shape", "final-action"].includes(rule)), rules.join(", "));
});

test("a flat middle slide is caught, and only that slide", () => {
  const flat = spec({
    slides: [
      spec().slides[0],
      spec().slides[1],
      { type: "paper", title: { lines: ["So I built", "*her*"] }, body: "She shows up every day with my voice." },
      ...spec().slides.slice(3),
    ],
  });
  const problems = checkSpec(flat, sources).filter((problem) => problem.rule === "no-pull");
  assert.equal(problems.length, 1);
  assert.equal(problems[0].slide, 3);
});

test("a last slide with no action is caught", () => {
  const quiet = spec({
    slides: [...spec().slides.slice(0, 4), { type: "keyword", keyword: "AVATAR", promise: "That is the whole system." }],
  });
  const problems = checkSpec(quiet, sources);
  assert.ok(problems.some((problem) => problem.rule === "final-action" && problem.slide === 5), JSON.stringify(problems));
});

test("the same pull twice, or an arrow on every slide, is caught", () => {
  const same = spec({
    slides: [
      { ...spec().slides[0], sub: "Here's how →" } as CarouselSpec["slides"][number],
      { type: "paper", title: { lines: ["Two"] }, body: "It was not the camera. Here's how →" },
      { type: "paper", title: { lines: ["Three"] }, body: "Then it got easier. Next →" },
      { type: "paper", title: { lines: ["Four"] }, body: "Every day since. Watch →" },
      spec().slides[4],
    ],
  });
  const rules = checkSpec(same, sources).map((problem) => problem.rule);
  assert.ok(rules.includes("pull-repeated"), rules.join(", "));
  assert.ok(rules.includes("pull-shape"), rules.join(", "));
});

test("a pinned cover is never called flat; the writer's slides still are", () => {
  const pinned = spec({
    slides: [
      { type: "cover", photo: "p00", title: { lines: ["Cancel your plans", "tonight"] } },
      { type: "paper", title: { lines: ["Two"] }, body: "It was a normal day." },
      ...spec().slides.slice(2),
    ],
  });
  const flagged = checkSpec(pinned, { ...sources, fixedCover: true }).filter((problem) => problem.rule === "no-pull");
  assert.deepEqual(flagged.map((problem) => problem.slide), [2]);
});

test("pulls and actions are read loosely", () => {
  for (const line of ["Here's how →", "But that was not the part that worked.", "The fix is next.", "So what changed?", "Three things did it:", "Wait for it..."]) {
    assert.ok(isPull(line), line);
  }
  for (const line of ["She shows up every day with my voice.", "That is what consistency looks like."]) assert.ok(!isPull(line), line);
  assert.ok(isAction("Comment it and I will send the guide."));
  assert.ok(isAction("Save this for your first week."));
  assert.ok(!isAction("That is the whole system."));
});

test("a sentence and a short pull after it is still one sentence", () => {
  const withPull = spec({
    slides: [spec().slides[0], { type: "paper", title: { lines: ["Two"] }, body: "I stopped filming. Here's why." }, ...spec().slides.slice(2)],
  });
  assert.ok(!checkSpec(withPull, sources).some((problem) => problem.rule === "body-one-sentence"));
});

test("a stock pull is flagged unless it names what the next slide is about", () => {
  assert.ok(isStockPull("The next move →", "Batch your scripts. Write a week in one sitting."));
  assert.ok(isStockPull("The fix is next.", "Post reels daily"));
  assert.ok(!isStockPull("Now comes the routine →", "My morning routine: one script, one render."));
  assert.ok(!isStockPull("So why did nobody watch the first ten?", "Anything"));
  const stock = spec({
    slides: [spec().slides[0], { type: "paper", title: { lines: ["Two"] }, body: "It was never the camera. Keep going →" }, ...spec().slides.slice(2)],
  });
  assert.ok(checkSpec(stock, sources).some((problem) => problem.rule === "stock-pull" && problem.slide === 2));
});

test("money language is flagged on the writer's slides and in the caption, never on her pinned cover", () => {
  assert.equal(moneyLanguage("Connect every reel to a resource that sells while you work."), "sells while you work");
  assert.equal(moneyLanguage("Turn reach into revenue"), "revenue");
  assert.equal(moneyLanguage("Post daily without filming"), null);
  const paid = spec({
    caption: "Comment AVATAR to start making money.",
    slides: [
      { type: "cover", photo: "p00", title: { lines: ["Make money", "without a camera"] }, sub: "Here's how →" },
      { type: "paper", title: { lines: ["Turn reach", "into revenue"] }, body: "It sells while you work, but only if you do this?" },
      ...spec().slides.slice(2),
    ],
  });
  const flagged = checkSpec(paid, sources).filter((problem) => problem.rule === "money-language");
  assert.deepEqual([...new Set(flagged.map((problem) => problem.slide))], [1, 2, null]);
  const pinned = checkSpec(paid, { ...sources, fixedCover: true, coverText: "Make money without a camera" }).filter((problem) => problem.rule === "money-language");
  assert.ok(!pinned.some((problem) => problem.slide === 1));
});

test("a count promised on the cover is owed in slides", () => {
  assert.deepEqual(promisedItems("Use these 7 steps to get started"), { count: 7, noun: "steps" });
  assert.deepEqual(promisedItems("five quiet mistakes"), { count: 5, noun: "mistakes" });
  assert.equal(promisedItems("Cancel your plans tonight"), null);
  const short = spec({
    slides: [{ type: "cover", photo: "p00", title: { lines: ["Seven steps", "to post daily"] }, sub: "Here's how →" }, ...spec().slides.slice(1)],
  });
  const owed = checkSpec(short, sources).filter((problem) => problem.rule === "promised-count");
  assert.equal(owed.length, 1);
  assert.match(owed[0].detail, /7 steps/);
  const tooMany = spec({
    slides: [{ type: "cover", photo: "p00", title: { lines: ["Ten steps", "to post daily"] }, sub: "Here's how →" }, ...spec().slides.slice(1)],
  });
  assert.match(checkSpec(tooMany, sources).find((problem) => problem.rule === "promised-count")?.detail ?? "", /promise no more than 8/);
});

test("her pinned words keep her case in a caps kit; the writer's are set in caps", () => {
  const caps = ["bold", "pastel", "boxed", "serif", "serif_boxed", "signal", "atelier", "notebook"].map((id) => resolveKit(id)).find((entry) => entry.titleUppercase);
  assert.ok(caps, "a kit that sets titles in caps");
  if (!caps) return;
  const box = { maxWidth: 872, maxHeight: 700 };
  const text = (layout: ReturnType<typeof layoutTitle>) => layout.lines[0].runs.map((run) => run.text).join("");
  assert.equal(text(layoutTitle(caps, { lines: ["-start a new IG page"], asTyped: true }, box)), "-start a new IG page");
  assert.equal(text(layoutTitle(caps, { lines: ["-start a new IG page"] }, box)), "-START A NEW IG PAGE");
});

test("spelled numbers and loose quantities are traced like digits", () => {
  const spelled = spec({
    slides: [
      spec().slides[0],
      { type: "paper", title: { lines: ["Clone her", "voice"] }, body: "Record four minutes of speech, but what should the bio say?" },
      { type: "paper", title: { lines: ["Batch the", "week"] }, body: "Render them in one hour. So what do you post first..." },
      { type: "paper", title: { lines: ["A thousand", "followers"] }, body: "Dozens of reels, half the effort. Which one worked?" },
      spec().slides[4],
    ],
  });
  const flagged = checkSpec(spelled, sources).filter((problem) => problem.rule === "unsupported-number");
  const said = flagged.map((problem) => problem.detail).join(" | ");
  for (const claim of ["(4)", "(1)", "dozens", "half"]) assert.ok(said.includes(claim), `${claim} in ${said}`);
  // "a thousand followers" is her proof point, spelled out: traceable.
  assert.ok(!flagged.some((problem) => problem.slide === 4 && /1,000/.test(problem.detail)), said);
  // Her story says 2-3 a day; "two to three" is the same claim. Articles are not numbers.
  const fine = spec({
    slides: [spec().slides[0], { type: "paper", title: { lines: ["Post two to", "three a day"] }, body: "A day at a time, but how?" }, ...spec().slides.slice(2)],
  });
  assert.ok(!checkSpec(fine, sources).some((problem) => problem.rule === "unsupported-number"));
});

test("her pinned words may say any number; the writer's pull on the same slide may not", () => {
  const cover = "Cancel your plans tonight\n\nDo this instead.\n\n-start a new IG page\n-block everyone you know\n-post daily reels\n\nYour life could look completely different six months from now.\n\nUse these seven steps to get started";
  const pinned = spec({
    slides: [
      { type: "cover", photo: "p00", title: { lines: ["Cancel your plans tonight", "Do this instead."] } },
      { type: "paper", title: { lines: ["-start a new IG page"], asTyped: true }, body: "Your life could look completely different six months from now. It takes four minutes a day, but how?" },
      ...spec().slides.slice(2),
    ],
  });
  const flagged = checkSpec(pinned, { ...sources, fixedCover: true, coverText: cover, coverSplit: true }).filter((problem) => problem.rule === "unsupported-number");
  assert.equal(flagged.length, 1, JSON.stringify(flagged));
  assert.match(flagged[0].detail, /\(4\)/);
});

test("more than two pulls of one shape are flagged, naming the shapes still unused", () => {
  const formula = spec({
    slides: [
      { ...spec().slides[0], sub: "It started with one photo, but what came next?" } as CarouselSpec["slides"][number],
      { type: "paper", title: { lines: ["Two"] }, body: "Design her face, but how does she sound?" },
      { type: "paper", title: { lines: ["Three"] }, body: "Clone the voice, but what goes in the bio?" },
      { type: "paper", title: { lines: ["Four"] }, body: "Say it is AI, but what does she say?" },
      spec().slides[4],
    ],
  });
  const shape = checkSpec(formula, sources).filter((problem) => problem.rule === "pull-shape");
  assert.equal(shape.length, 1);
  assert.match(shape[0].detail, /4 pulls are a question after a but\/how\/what clause/);
  assert.match(shape[0].detail, /a line ending in an arrow/);
  assert.match(shape[0].detail, /unfinished thought/);
  assert.ok(!checkSpec(spec(), sources).some((problem) => problem.rule === "pull-shape"));
});

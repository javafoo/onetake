import assert from "node:assert/strict";
import { test } from "node:test";

import { tidyGlyphs } from "./glyphs";
import { layoutCue, layoutHook, renderOverlay } from "./overlay";
import { DEFAULT_CENTRE, SAFE_BOTTOM, SAFE_TOP, placeBlock, placeCue, clearHeight } from "./placement";
import { clipSecondsFor, CUE_MIN_VISIBLE_SECONDS, CUE_SECONDS, HOLD_SECONDS, LONGEST_SECONDS, MAX_SECONDS, MIN_SECONDS, readingSeconds, TARGET_SECONDS, timeline } from "./timing";

const LONG = "I spent three years wanting to build an online income, but the thought of my coworkers seeing my videos stopped me every time.";

test("duration follows reading time and is clamped", () => {
  assert.equal(readingSeconds("Stop scrolling"), MIN_SECONDS);
  assert.equal(readingSeconds("word ".repeat(200)), LONGEST_SECONDS);
  const mid = readingSeconds("word ".repeat(20)); // 20 / 3.3 + 0.8
  assert.ok(mid > 6.8 && mid < 6.9, String(mid));
  assert.throws(() => readingSeconds("   "), /empty/);
});

test("a long hook gets a smaller font than a short one, and keeps every word", () => {
  const short = layoutHook("Nobody tells you this about posting");
  const long = layoutHook(LONG);
  assert.ok(long.fontSize < short.fontSize, `${long.fontSize} vs ${short.fontSize}`);
  assert.equal(long.lines.join(" "), LONG);
});

test("lines are balanced: no one-word last line on a long hook", () => {
  const { lines } = layoutHook(LONG);
  assert.ok(lines[lines.length - 1].split(" ").length > 1, lines.join(" | "));
});

test("with no face the block sits at the default centre", () => {
  const placed = placeBlock(0.2, null);
  assert.equal(placed.reason, "default");
  assert.ok(Math.abs(placed.top + 0.1 - DEFAULT_CENTRE) < 1e-9);
});

test("a face high in the frame leaves the default spot alone", () => {
  assert.equal(placeBlock(0.18, { top: 0.08, bottom: 0.25 }).reason, "default");
});

test("a face in the middle pushes the block just under it, inside the safe area", () => {
  const face = { top: 0.18, bottom: 0.52 };
  const placed = placeBlock(0.2, face);
  assert.equal(placed.reason, "below_face");
  assert.ok(placed.top > face.bottom);
  assert.ok(placed.top + 0.2 <= SAFE_BOTTOM);
});

test("a face low in the frame sends the block above it", () => {
  const placed = placeBlock(0.18, { top: 0.45, bottom: 0.75 });
  assert.equal(placed.reason, "above_face");
  assert.ok(placed.top >= SAFE_TOP);
});

test("a face that fills the frame falls back to the lowest safe position", () => {
  const placed = placeBlock(0.25, { top: 0.1, bottom: 0.7 });
  assert.equal(placed.reason, "lowest_safe");
  assert.ok(Math.abs(placed.top + 0.25 - SAFE_BOTTOM) < 1e-9);
});

test("without a cue the timeline is the hook's reading time", () => {
  const t = timeline(LONG);
  assert.equal(t.cueAt, null);
  assert.equal(t.duration, readingSeconds(LONG));
  assert.deepEqual(timeline(LONG, "   "), t);
});

test("a cue appears when the hook has been read and extends the reel", () => {
  const short = "Nobody tells you this about posting every day"; // 8 words: well inside the cap
  const t = timeline(short, "Read the caption");
  assert.ok(t.cueAt !== null && Math.abs(t.cueAt - (t.hookSeconds - HOLD_SECONDS)) < 1e-9, String(t.cueAt));
  assert.ok(Math.abs(t.duration - (t.hookSeconds + CUE_SECONDS)) < 1e-9, String(t.duration));
  assert.ok(t.cueAt! < t.duration);
});

test("a cue never pushes a reel past the cap, and stays visible long enough", () => {
  const t = timeline(LONG, "Read the caption"); // 22 words: the hook alone is under 8s, with the cue it would not be
  assert.equal(t.duration, MAX_SECONDS);
  assert.ok(t.cueAt !== null && t.cueAt <= MAX_SECONDS - CUE_MIN_VISIBLE_SECONDS + 1e-9, String(t.cueAt));
  // A long hook does not stretch the reel: it gets the usual six seconds and loops while she reads.
  const long = timeline("word ".repeat(36), "Read the caption");
  assert.ok(long.hookSeconds > MAX_SECONDS && long.hookSeconds <= LONGEST_SECONDS);
  assert.equal(long.duration, Math.min(MAX_SECONDS, TARGET_SECONDS + CUE_SECONDS));
  assert.ok(long.cueAt !== null && long.cueAt < long.duration && long.cueAt >= long.duration - CUE_MIN_VISIBLE_SECONDS - 1e-9);
  assert.equal(timeline("word ".repeat(36)).duration, TARGET_SECONDS);
});

test("a generated clip is as long as the reel, in whole seconds, five to eight", () => {
  assert.equal(clipSecondsFor("Stop scrolling"), MIN_SECONDS);
  assert.equal(clipSecondsFor(LONG, "Read the caption"), MAX_SECONDS);
  // A story hook in groups reads for eleven seconds; the reel is still six and loops while she reads.
  const story = "I make an income online\nI am not an influencer\n\nI do not do UGC\nand I never show my face\n\nHere is how I do it every single day";
  assert.ok(readingSeconds(story) > MAX_SECONDS);
  assert.equal(clipSecondsFor(story), TARGET_SECONDS);
  assert.equal(clipSecondsFor("word ".repeat(80)), TARGET_SECONDS);
  const six = clipSecondsFor("I post every single day and I have never once filmed myself, and nobody at work knows"); // 17 words: 5.15 + 0.8 = 5.95 -> 6
  assert.equal(six, 6);
});

test("a cue is one line at the hook's own size", () => {
  const hook = layoutHook("Nobody tells you this about posting");
  const cue = layoutCue("Read the caption", undefined, hook.fontSize);
  assert.equal(cue.lines.length, 1);
  assert.equal(cue.fontSize, hook.fontSize);
  assert.equal(cue.blockHeight, cue.lineHeight);
});

test("the cue sits under the hook when there is room", () => {
  const hook = { top: 0.3, height: 0.12 };
  const placed = placeCue(hook, 0.03, null);
  assert.equal(placed.reason, "below_hook");
  assert.ok(placed.top > hook.top + hook.height);
  assert.ok(placed.top + 0.03 <= SAFE_BOTTOM);
});

test("the cue moves above the hook when the face is right under it", () => {
  const hook = { top: 0.2, height: 0.12 };
  const placed = placeCue(hook, 0.03, { top: 0.33, bottom: 0.6 });
  assert.equal(placed.reason, "above_hook");
  assert.ok(placed.top >= SAFE_TOP);
  assert.ok(placed.top + 0.03 <= hook.top);
});

test("a hook at the bottom of the safe area pushes the cue above it", () => {
  const hook = { top: SAFE_BOTTOM - 0.1, height: 0.1 };
  assert.equal(placeCue(hook, 0.03, null).reason, "above_hook");
});

test("with no clear spot the cue still stays inside the safe area", () => {
  const hook = { top: SAFE_BOTTOM - 0.1, height: 0.1 };
  const placed = placeCue(hook, 0.03, { top: 0.1, bottom: SAFE_BOTTOM - 0.1 });
  assert.ok(placed.top >= SAFE_TOP && placed.top + 0.03 <= SAFE_BOTTOM);
});

test("the elegant style keeps every word, sets a small quiet serif, and has no box", () => {
  const box = layoutHook(LONG);
  const elegant = layoutHook(LONG, "serif");
  assert.equal(elegant.lines.join(" "), LONG);
  assert.equal(elegant.style, "serif");
  // A quarter smaller than the boxed sans at the same words: the reference reels are typed small.
  assert.ok(elegant.fontSize <= box.fontSize && elegant.fontSize >= 29, `${elegant.fontSize} vs ${box.fontSize}`);
  assert.equal(layoutCue("Read the caption", "serif").style, "serif");
  assert.ok(renderOverlay(elegant, 400).length > 0);
});

test("an elegant hook written as short lines keeps its lines and its group gaps, inside the wider margins", () => {
  const written = "I stopped filming myself\nsix months ago\n\nI still post every day\n\nHere is what changed";
  const layout = layoutHook(written, "serif");
  assert.deepEqual(layout.lines, ["I stopped filming myself", "six months ago", "", "I still post every day", "", "Here is what changed"]);
  assert.equal(layout.tops.length, layout.lines.length);
  // A gap is a whole empty line, the way the reference reels are typed, so the block is six lines tall.
  assert.equal(layout.blockHeight, 6 * layout.lineHeight);
  assert.ok(renderOverlay(layout, 300).length > 0);
  // The same words with no breaks are wrapped as before.
  assert.ok(layoutHook(written.replace(/\n+/g, " "), "serif").lines.every(Boolean));
});

test("a hook written in groups keeps its groups in the boxed style too", () => {
  const written = "I make an income online\nI am not an influencer\n\nI never show my face\n\nHere is how";
  const layout = layoutHook(written);
  assert.equal(layout.style, "boxed");
  assert.deepEqual(layout.lines, ["I make an income online", "I am not an influencer", "", "I never show my face", "", "Here is how"]);
  assert.ok(renderOverlay(layout, 300).length > 0);
});

test("emoji arrows become arrows the fonts have, and other emoji are dropped", () => {
  assert.equal(tidyGlyphs("Here is what happened ➡️"), "Here is what happened →");
  assert.equal(tidyGlyphs("Read the caption 👇"), "Read the caption ↓");
  assert.equal(tidyGlyphs("I built an AI avatar 🤖✨ instead\nHere is how ⬇️"), "I built an AI avatar instead\nHere is how ↓");
  assert.equal(tidyGlyphs("Plain words stay, and so do ↓ → arrows"), "Plain words stay, and so do ↓ → arrows");
  assert.equal(layoutHook("Here is what happened ➡️").lines.join(" "), "Here is what happened →");
});

test("a long written hook shrinks to a height limit instead of running past it", () => {
  const hook = "I am begging you\n\n1. Start a new faceless Instagram account.\n\n2. Block everyone you know.\n\n3. Post two simple 5-7 seconds reels a day without even showing your face.\n\n4. Monetise with digital products while still working 9-5 no one even has to know it's you.\n\n5. Make money online through faceless digital marketing in 2 hours/ day.";
  const free = layoutHook(hook, "serif_boxed");
  const limit = Math.round(free.blockHeight * 0.8);
  const fitted = layoutHook(hook, "serif_boxed", limit);
  assert.ok(fitted.blockHeight <= limit, `${fitted.blockHeight} > ${limit}`);
  assert.ok(fitted.fontSize < free.fontSize);
  // Every word is still there, in order: only the size and the wrapping changed.
  const words = (layout: { lines: string[] }) => layout.lines.join(" ").split(/\s+/).filter(Boolean).join(" ");
  assert.equal(words(fitted), words(free));
});

test("the clear band beside a face is the taller of above and below, inside the safe area", () => {
  assert.equal(clearHeight(null), SAFE_BOTTOM - SAFE_TOP);
  const face = { top: 0.24, bottom: 0.44 };
  // Below: 0.78 - 0.47 = 0.31; above: 0.21 - 0.12 = 0.09.
  assert.ok(Math.abs(clearHeight(face) - 0.31) < 1e-9);
  assert.equal(clearHeight({ top: 0.1, bottom: 0.9 }), 0);
});

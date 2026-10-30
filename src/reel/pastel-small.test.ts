import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveKit } from "../carousel/kits";
import { coverSubSize, coverTitleMax } from "../carousel/render";
import { FORMATS } from "../carousel/spec";
import { PASTEL_SMALL_BOOST, PASTEL_SMALL_COLUMN, SMALL_COLUMN, smallBoost, smallColumn } from "../content/text-styles";
import { FRAME, layoutCue, layoutHook } from "./overlay";

/* The pastel look at the small size is drawn 30% bigger (owner, 2026-10-05).
   Only that one look and size moved: these tests pin the new numbers and
   that nothing else did. */

const QUOTE = "take the risk. worst case, you learn something.";

test("only pastel small is boosted, by 30%", () => {
  assert.equal(PASTEL_SMALL_BOOST, 1.3);
  assert.equal(smallBoost("pastel"), 1.3);
  for (const other of ["bold", "boxed", "serif", "serif_boxed"]) {
    assert.equal(smallBoost(other), 1, other);
    assert.equal(smallColumn(other), SMALL_COLUMN, other);
  }
  assert.equal(smallColumn("pastel"), PASTEL_SMALL_COLUMN);
});

test("a pastel small reel hook is 57px, up from 44px; bold and serif stay at 44px", () => {
  assert.equal(layoutHook(QUOTE, "pastel", undefined, "small").fontSize, 57);
  assert.equal(layoutHook(QUOTE, "bold", undefined, "small").fontSize, 44);
  assert.equal(layoutHook(QUOTE, "serif", undefined, "small").fontSize, 44);
});

test("the boxed looks' small reel sizes did not move", () => {
  assert.equal(layoutHook(QUOTE, "boxed", undefined, "small").fontSize, 46);
});

test("pastel large is as it was", () => {
  assert.equal(layoutHook("take the risk", "pastel", undefined, "large").fontSize, 44);
});

test("a long pastel small hook steps down toward the 44px floor instead of overflowing", () => {
  const long = layoutHook("The one thing nobody tells you about starting over in a new city is how quiet the first month is, and how loud the second one gets.", "pastel", 450, "small");
  assert.ok(long.fontSize < 57, `${long.fontSize}`);
  assert.ok(long.blockHeight <= 450, `${long.blockHeight}`);
  assert.ok(long.lines.length > 1);
});

test("a pastel small cue follows the hook's size", () => {
  const hook = layoutHook(QUOTE, "pastel", undefined, "small");
  assert.equal(layoutCue("save this", "pastel", hook.fontSize, "small").fontSize, 57);
  assert.equal(layoutCue("save this", "pastel", undefined, "small").fontSize, 57);
});

test("the pastel small reel column leaves 151px clear of each edge", () => {
  const margin = (FRAME.width - Math.round(FRAME.width * smallColumn("pastel"))) / 2;
  assert.equal(margin, 151);
});

test("words on a photo: pastel small starts 30% bigger than before, in 4:5 and 16:9 alike", () => {
  const pastel = resolveKit("pastel");
  const bold = resolveKit("bold");
  const photo45 = { width: 1080, height: 1350 };
  const photo169 = { width: 1080, height: 608 };
  // 96 x 0.5 = 48 before; x 1.3 = 62.4.
  assert.equal(Math.round(coverTitleMax(pastel, photo45, "small")), 62);
  assert.equal(Math.round(coverTitleMax(pastel, photo169, "small")), 62);
  assert.equal(Math.round(coverTitleMax(bold, photo45, "small")), Math.round(bold.titleSize.max * 0.5));
  // Large is untouched, and so is the sentence under a large title.
  assert.equal(coverTitleMax(pastel, photo45, "large"), pastel.titleSize.max);
  assert.equal(coverSubSize(pastel, "large"), pastel.photo.subSize);
  assert.equal(coverSubSize(pastel, "small"), Math.round(pastel.photo.subSize * 0.5 * 1.3 * 1.3));
});

test("a carousel story cover takes the same pastel boost", () => {
  const pastel = resolveKit("pastel");
  assert.equal(Math.round(coverTitleMax(pastel, FORMATS.story, "small")), Math.round(pastel.titleSize.max * 1.18 * 0.5 * 1.3));
});

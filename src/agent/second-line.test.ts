import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanCue, commentWord, MAX_OWN_LINE, refusesSecondLine, secondLineLabel, secondLineText } from "./second-line";

test("each second-line choice becomes the words on the reel", () => {
  assert.equal(secondLineText({ kind: "none" }), undefined);
  assert.equal(secondLineText({ kind: "caption" }), "Read the caption");
  assert.equal(secondLineText({ kind: "comment", word: " guide! " }), "Comment GUIDE");
  assert.equal(secondLineText({ kind: "comment", word: "  " }), undefined);
  assert.equal(secondLineText({ kind: "own", text: "  Link  in bio " }), "Link in bio");
  assert.equal(secondLineText({ kind: "own", text: "x".repeat(60) })?.length, MAX_OWN_LINE);
});

test("the chip reads the line, or None", () => {
  assert.equal(secondLineLabel({ kind: "none" }), "None");
  assert.equal(secondLineLabel({ kind: "comment", word: "avatar" }), "Comment AVATAR");
});

test("a comment word is one word in capitals", () => {
  assert.equal(commentWord("start here"), "START");
  assert.equal(commentWord("#dm"), "DM");
});

test("a cue from a form is one short line or nothing", () => {
  assert.equal(cleanCue("Read\nthe caption"), "Read the caption");
  assert.equal(cleanCue("   "), undefined);
  assert.equal(cleanCue(42), undefined);
  assert.equal(cleanCue("y".repeat(100))?.length, 40);
});

test("her words saying no second line are read as a refusal", () => {
  assert.ok(refusesSecondLine("make a reel about mornings, no second line"));
  assert.ok(refusesSecondLine("No read the caption please"));
  assert.ok(refusesSecondLine("just the hook, nothing else"));
  assert.ok(refusesSecondLine("without a second line"));
  assert.ok(!refusesSecondLine("add a second line that says read the caption"));
  assert.ok(!refusesSecondLine("a reel about my hook writing"));
});

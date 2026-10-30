import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_TEXT_STYLE, TEXT_STYLES, normalizeTextSize, normalizeTextStyle, onScreenCase, textChipLabel, type TextStyle } from "./text-styles";

test("normalizeTextStyle keeps the five ids", () => {
  for (const id of Object.keys(TEXT_STYLES) as TextStyle[]) assert.equal(normalizeTextStyle(id), id);
});

test("normalizeTextStyle maps legacy values and falls back to the default", () => {
  assert.equal(normalizeTextStyle("box"), "boxed");
  assert.equal(normalizeTextStyle("elegant"), "serif");
  assert.equal(normalizeTextStyle("standard"), "boxed");
  assert.equal(normalizeTextStyle("house"), DEFAULT_TEXT_STYLE);
  assert.equal(normalizeTextStyle(undefined), DEFAULT_TEXT_STYLE);
  assert.equal(normalizeTextStyle(42), DEFAULT_TEXT_STYLE);
  assert.equal(DEFAULT_TEXT_STYLE, "boxed");
});

test("normalizeTextSize reads old rows as large", () => {
  assert.equal(normalizeTextSize("small"), "small");
  assert.equal(normalizeTextSize("large"), "large");
  assert.equal(normalizeTextSize(undefined), "large");
  assert.equal(normalizeTextSize("huge"), "large");
});

test("onScreenCase lowercases only when asked", () => {
  assert.equal(onScreenCase("Take The Risk", true), "take the risk");
  assert.equal(onScreenCase("Take The Risk", false), "Take The Risk");
  assert.equal(onScreenCase("Take The Risk", undefined), "Take The Risk");
});

test("the Text chip names only what differs from the defaults", () => {
  assert.equal(textChipLabel("pastel", "large", false), "Text · Pastel");
  assert.equal(textChipLabel("pastel", "small", true), "Text · Pastel · Small · aa");
  assert.equal(textChipLabel("serif", "large", true), "Text · Serif · aa");
});

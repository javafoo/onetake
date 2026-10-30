import assert from "node:assert/strict";
import { test } from "node:test";

import { parseHouseStyle, PLAIN_STYLE } from "./load-style";

test("no HOUSE_STYLE means the plain style", () => {
  assert.equal(parseHouseStyle(undefined), PLAIN_STYLE);
  assert.equal(parseHouseStyle("  "), PLAIN_STYLE);
});

test("a complete style in HOUSE_STYLE replaces the plain one", () => {
  const own = { ...PLAIN_STYLE, judge: "Keep it if it looks like her." };
  assert.equal(parseHouseStyle(JSON.stringify(own)).judge, "Keep it if it looks like her.");
  assert.equal(parseHouseStyle(Buffer.from(JSON.stringify(own)).toString("base64")).judge, "Keep it if it looks like her.");
});

test("a broken or partial HOUSE_STYLE falls back to the plain style", () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(parseHouseStyle("{not json"), PLAIN_STYLE);
    assert.equal(parseHouseStyle(JSON.stringify({ ...PLAIN_STYLE, everyday: { look: "x" } })), PLAIN_STYLE);
  } finally {
    console.warn = warn;
  }
});

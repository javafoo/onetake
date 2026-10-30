import assert from "node:assert/strict";
import { test } from "node:test";

import { textLookInput, withOptions } from "./options";
import type { AgentRequest } from "./plan";
import { textLookFromMessage, withTextLook } from "./text-look";

test("size and case are read off her plain words", () => {
  assert.deepEqual(textLookFromMessage("add this quote to my photo, small text"), { size: "small" });
  assert.deepEqual(textLookFromMessage("smaller"), { size: "small" });
  assert.deepEqual(textLookFromMessage("same again but smaller please"), { size: "small" });
  assert.deepEqual(textLookFromMessage("make the text a bit smaller"), { size: "small" });
  assert.deepEqual(textLookFromMessage("big text this time"), { size: "large" });
  assert.deepEqual(textLookFromMessage("reel with this hook, all lowercase"), { lowercase: true });
  assert.deepEqual(textLookFromMessage("put it in lowercase, small text"), { size: "small", lowercase: true });
  assert.deepEqual(textLookFromMessage("keep my capitals"), { lowercase: false });
});

test("a brief that only mentions size is not an ask about the type", () => {
  assert.deepEqual(textLookFromMessage("a reel about why smaller accounts grow faster"), {});
  assert.deepEqual(textLookFromMessage("a carousel on big goals for small businesses"), {});
});

test("the picker wins over the words when she changed it", () => {
  const request: AgentRequest = { kind: "text_photo", brief: "b", words: "w", material: { photos: ["p"] } };
  const asked = withTextLook(request, textLookFromMessage("small text, lowercase"));
  assert.ok(asked.kind === "text_photo");
  assert.equal(asked.size, "small");
  assert.equal(asked.lowercase, true);
  const picked = withOptions(asked, { size: "large", lowercase: false });
  assert.equal(picked.kind === "text_photo" && picked.size, "large");
  assert.equal(picked.kind === "text_photo" && picked.lowercase, false);
  // Unpicked, the words stand.
  const unpicked = withOptions(asked, {});
  assert.equal(unpicked.kind === "text_photo" && unpicked.size, "small");
});

test("photos draw no words, so they take no size", () => {
  const photos = { kind: "photos" as const, brief: "b", count: 1, mode: "one" as const };
  assert.deepEqual(withTextLook(photos, { size: "small" }), photos);
});

test("a manual job carries only small and a true lowercase", () => {
  assert.deepEqual(textLookInput({ size: "small", lowercase: true }), { size: "small", lowercase: true });
  assert.deepEqual(textLookInput({ size: "large", lowercase: false }), {});
  assert.deepEqual(textLookInput({ size: "tiny", lowercase: "yes" }), {});
});

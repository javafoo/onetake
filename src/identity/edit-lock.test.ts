import assert from "node:assert/strict";
import { test } from "node:test";

import type { IdentityLock } from "./build";
import { lockFromEdit, lockWithStyle, type LockEdit } from "./edit-lock";

/* Her description, edited after setup. The house lists are server-only, so a
   stand-in list is handed in: what matters is that any listed word is refused. */

const NEVER = ["asian", "latina", "studio", "editorial", "film"];

const existing: IdentityLock = {
  subject: "a woman in her late twenties, slim build",
  hair: "long dark wavy hair",
  skinMakeup: "warm skin, soft brown eyeliner",
  accessories: "small gold hoops",
  expressions: "a soft closed-mouth smile",
  wardrobe: ["cream knit cardigan"],
  scenes: ["a sunny cafe table"],
  bannedWords: ["blonde"],
};

const edit = (patch: Partial<LockEdit> = {}): LockEdit => ({
  subject: existing.subject,
  hair: existing.hair,
  skinMakeup: existing.skinMakeup,
  accessories: existing.accessories,
  expressions: existing.expressions,
  wardrobe: existing.wardrobe.join("\n"),
  scenes: existing.scenes.join("\n"),
  ...patch,
});

test("her edits are saved as she wrote them, lists one per line, and the learned words are kept", () => {
  const result = lockFromEdit(existing, edit({ hair: "  shoulder-length   dark bob ", wardrobe: "black slip dress\n\n oversized blazer \n" }), NEVER);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.lock.hair, "shoulder-length dark bob");
    assert.deepEqual(result.lock.wardrobe, ["black slip dress", "oversized blazer"]);
    assert.deepEqual(result.lock.bannedWords, ["blonde"], "learned from photos, not typed");
  }
});

test("a word no prompt may use is refused by name, before anything is saved", () => {
  const ethnic = lockFromEdit(existing, edit({ subject: "an Asian woman in her twenties" }), NEVER);
  assert.equal(ethnic.ok, false);
  if (!ethnic.ok) assert.match(ethnic.message, /Who she is uses “asian”/);
  const look = lockFromEdit(existing, edit({ scenes: "a photo studio with softbox light" }), NEVER);
  assert.equal(look.ok, false);
  if (!look.ok) assert.match(look.message, /Usual places uses “studio”/);
  // Her own learned list counts too: a word that pushed her off-model stays out.
  assert.equal(lockFromEdit(existing, edit({ hair: "blonde highlights" }), NEVER).ok, false);
});

test("the three fields that keep her looking like herself cannot be emptied, and nothing runs to an essay", () => {
  for (const key of ["subject", "hair", "skinMakeup"] as const) {
    assert.equal(lockFromEdit(existing, edit({ [key]: "   " }), NEVER).ok, false, key);
  }
  assert.equal(lockFromEdit(existing, edit({ accessories: "" }), NEVER).ok, true, "accessories may be empty");
  assert.equal(lockFromEdit(existing, edit({ hair: "long ".repeat(100) }), NEVER).ok, false);
  assert.equal(lockFromEdit(existing, edit({ wardrobe: Array.from({ length: 13 }, (_, i) => `outfit ${i}`).join("\n") }), NEVER).ok, false);
});

/* The photo style rides on the lock. */

const BASE: IdentityLock = {
  subject: "a woman in her late 20s, slender",
  hair: "long dark hair in loose waves",
  skinMakeup: "warm tan skin, soft peach blush",
  accessories: "small gold hoops",
  expressions: "calm and direct",
  wardrobe: ["navy pinstripe blazer"],
  scenes: ["a styled studio with a cream sofa"],
  bannedWords: ["glow"],
};

test("editing her description keeps the style she chose", () => {
  const edit = { subject: BASE.subject, hair: BASE.hair, skinMakeup: BASE.skinMakeup, accessories: BASE.accessories, expressions: BASE.expressions, wardrobe: "blazer", scenes: "a sofa" };
  const result = lockFromEdit({ ...BASE, photoStyle: "editorial" }, edit, []);
  assert.equal(result.ok && result.lock.photoStyle, "editorial");
  const plain = lockFromEdit(BASE, edit, []);
  assert.equal(plain.ok && "photoStyle" in plain.lock, false);
});

test("switching to editorial writes the style; switching back removes the field", () => {
  const editorial = lockWithStyle(BASE, "editorial", []);
  assert.equal(editorial.ok && editorial.lock.photoStyle, "editorial");
  const back = lockWithStyle(editorial.ok ? editorial.lock : BASE, "everyday", []);
  assert.equal(back.ok && "photoStyle" in back.lock, false);
  assert.equal(back.ok && back.lock.bannedWords.join(), "glow");
});

test("a switch to a stricter style is refused by name when her description uses a word it never writes", () => {
  const result = lockWithStyle({ ...BASE, photoStyle: "editorial" }, "everyday", ["studio"]);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.message, /Usual places \(“studio”\)/);
  assert.match(result.ok ? "" : result.message, /everyday/);
});

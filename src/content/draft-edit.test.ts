import assert from "node:assert/strict";
import { test } from "node:test";

import { InvalidRequestError } from "../lib/errors";

import { checkDraftEdit, checkHook, checkReelHook, checkSavedHook, MAX_CAPTION_CHARS } from "./draft-edit";
import { MAX_SAVED_HOOK_CHARS, MAX_SAVED_HOOK_WORDS } from "../data/hook-rules";
import { MAX_HOOK_WORDS } from "./hooks";

/* A hand-edited draft has to pass the rules the writer passes. These are the
   ones a person actually trips over. */

const words = (count: number) => Array.from({ length: count }, (_, i) => `word${i}`).join(" ");

const good = {
  hook: "I stopped posting every day and my reach went up.",
  caption: "Here is what happened in the four weeks after I stopped.",
  cta: "Comment START and I will send you the checklist.",
};

test("a clean edit comes back trimmed and unchanged otherwise", () => {
  const saved = checkDraftEdit({ hook: `  ${good.hook}  `, caption: `${good.caption}\n`, cta: ` ${good.cta}` }, "START");
  assert.deepEqual(saved, good);
});

test("a hook over the reel limit is refused, and told how much to cut", () => {
  const long = words(MAX_HOOK_WORDS + 4);
  assert.throws(
    () => checkDraftEdit({ ...good, hook: long }, "START"),
    (error: unknown) => {
      assert.ok(error instanceof InvalidRequestError);
      assert.match(error.message, new RegExp(`${MAX_HOOK_WORDS + 4} words`));
      assert.match(error.message, /so cut 4/);
      return true;
    },
  );
  // Exactly at the limit is fine: the reel is as long as the hook takes to read.
  assert.equal(checkDraftEdit({ ...good, hook: words(MAX_HOOK_WORDS) }, "START").hook, words(MAX_HOOK_WORDS));
});

test("a call to action that drops the keyword is refused by name", () => {
  assert.throws(
    () => checkDraftEdit({ ...good, cta: "Comment below and I will send it over." }, "START"),
    (error: unknown) => {
      assert.ok(error instanceof InvalidRequestError);
      assert.match(error.message, /"START"/);
      return true;
    },
  );
  // Case is not the point: the word being there is.
  assert.doesNotThrow(() => checkDraftEdit({ ...good, cta: "comment start for the list" }, "START"));
});

test("an account with no keyword yet is not stopped from editing", () => {
  assert.doesNotThrow(() => checkDraftEdit({ ...good, cta: "Link in bio." }, ""));
  assert.doesNotThrow(() => checkDraftEdit({ ...good, cta: "Link in bio." }, "   "));
});

test("an empty hook or caption is refused, and a caption longer than Instagram takes", () => {
  assert.throws(() => checkDraftEdit({ ...good, hook: "   " }, "START"), InvalidRequestError);
  assert.throws(() => checkDraftEdit({ ...good, caption: "" }, "START"), InvalidRequestError);
  assert.throws(
    () => checkDraftEdit({ ...good, caption: "x".repeat(MAX_CAPTION_CHARS + 1) }, "START"),
    InvalidRequestError,
  );
  assert.doesNotThrow(() => checkDraftEdit({ ...good, caption: "x".repeat(MAX_CAPTION_CHARS) }, "START"));
});

test("a hook on its own is trimmed, and refused empty or over the limit before anything is written", () => {
  assert.equal(checkHook(`  ${good.hook}\n`), good.hook);
  assert.throws(() => checkHook("   "), InvalidRequestError);
  assert.throws(() => checkHook(words(MAX_HOOK_WORDS + 1)), InvalidRequestError);
  assert.equal(checkHook(words(MAX_HOOK_WORDS)), words(MAX_HOOK_WORDS));
});

test("a saved hook keeps any length a person writes, up to 200 words and 1500 characters", () => {
  // A 59-word story hook is over the reel's limit and still saved whole.
  assert.equal(checkSavedHook(`  ${words(59)} `), words(59));
  assert.ok(59 > MAX_HOOK_WORDS);
  assert.equal(checkSavedHook(words(MAX_SAVED_HOOK_WORDS)), words(MAX_SAVED_HOOK_WORDS));
  assert.throws(() => checkSavedHook(words(MAX_SAVED_HOOK_WORDS + 1)), InvalidRequestError);
  assert.throws(() => checkSavedHook("x".repeat(MAX_SAVED_HOOK_CHARS + 1)), InvalidRequestError);
  assert.doesNotThrow(() => checkSavedHook("x".repeat(MAX_SAVED_HOOK_CHARS)));
  assert.throws(() => checkSavedHook(" \n "), InvalidRequestError);
});

test("a pinned hook on a reel skips the reel's word limit; typed words keep it", () => {
  assert.equal(checkReelHook(words(57), true), words(57));
  assert.throws(() => checkReelHook(words(57), false), /57 words/);
  assert.throws(() => checkReelHook(words(MAX_SAVED_HOOK_WORDS + 1), true), InvalidRequestError);
});

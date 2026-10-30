import assert from "node:assert/strict";
import { test } from "node:test";

import { hookLevel, routeHookFields } from "./hook-level";

const LAURA = "My name is Laura\nI hate filming in public\n\nSo I sent Claude a selfie photo";

test("exact only when she says so or quotes the words", () => {
  assert.equal(hookLevel("make a reel with this exact hook"), "exact");
  assert.equal(hookLevel("use these words word for word"), "exact");
  assert.equal(hookLevel("same words please"), "exact");
  assert.equal(hookLevel("copy this exactly"), "exact");
  assert.equal(hookLevel('a reel with the hook "I never film myself"'), "exact");
  assert.equal(hookLevel('Use this exact hook: "Stop filming yourself" make it a reel'), "exact");
});

test("pointing at a screenshot's words adapts them", () => {
  assert.equal(hookLevel("make me a reel with this hook"), "adapt");
  assert.equal(hookLevel("make me video with this hook"), "adapt");
  assert.equal(hookLevel("this hook but for me"), "adapt");
  assert.equal(hookLevel("a carousel like this"), "adapt");
  assert.equal(hookLevel("copy this"), "adapt");
});

test("my version, something like this but about X, or nothing said is shape only", () => {
  assert.equal(hookLevel("make my version of this"), "shape");
  assert.equal(hookLevel("something like this but about batching content"), "shape");
  assert.equal(hookLevel("like this but about skincare"), "shape");
  assert.equal(hookLevel(""), "none");
  assert.equal(hookLevel("make me a reel about mornings"), "none");
});

test("the reader's fields go where her words send them", () => {
  // The reader copied the words into exact, but she only pointed at them: they are adapted.
  assert.deepEqual(routeHookFields("make me a reel with this hook", true, { exact: LAURA, reference: LAURA }), { template: LAURA, reference: LAURA });
  // She asked for the exact words: the template the reader filled is used as they are.
  assert.deepEqual(routeHookFields("use this hook word for word", true, { template: LAURA }), { exact: LAURA, reference: undefined });
  // My version: shape only, no words carried.
  assert.deepEqual(routeHookFields("make my version of this", true, { exact: LAURA, template: LAURA, reference: "Hook: ..." }), { reference: "Hook: ..." });
  // A screenshot and no instruction is shape; typed words with no screenshot stand as the reader read them.
  assert.deepEqual(routeHookFields("", true, { exact: LAURA }), { reference: LAURA });
  assert.deepEqual(routeHookFields("hook: I stopped filming", false, { exact: "I stopped filming" }), { exact: "I stopped filming", template: undefined, reference: undefined });
});

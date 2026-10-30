import assert from "node:assert/strict";
import test from "node:test";

import { creditsBuySentence, whatCreditsBuy } from "./gate";
import { CREDIT_USD, FREE_CREDITS, costUsd, creditsFor, type Action } from "./pricing";

/* The scale itself, pinned. These numbers are inside every button that
   spends, so changing one has to be a deliberate edit here as well. */

test("a credit is priced so that one of them buys one photo", () => {
  assert.equal(CREDIT_USD, 0.45);
  assert.equal(creditsFor({ kind: "image", model: "daily" }), 1);
});

test("every action the product sells has the price the pages promise", () => {
  assert.equal(creditsFor({ kind: "image", model: "pro" }), 2);
  assert.equal(creditsFor({ kind: "image", model: "daily" }), 1);
  assert.equal(creditsFor({ kind: "identity_view" }), 1);
  assert.equal(creditsFor({ kind: "clip", model: "omni", seconds: 5 }), 4);
});

test("rendering and writing cost nothing", () => {
  for (const kind of ["reel", "carousel", "text"] as const) {
    assert.equal(costUsd({ kind }), 0, kind);
    assert.equal(creditsFor({ kind }), 0, kind);
  }
});

test("a price is always a whole number of credits that covers its cost", () => {
  const actions: Action[] = [
    { kind: "image", model: "pro" },
    { kind: "image", model: "daily" },
    { kind: "identity_view" },
    ...[3, 5, 8, 10].map((seconds): Action => ({ kind: "clip", model: "omni", seconds })),
  ];
  for (const action of actions) {
    const credits = creditsFor(action);
    const where = JSON.stringify(action);
    assert.ok(Number.isInteger(credits), `${where}: ${credits} is not whole`);
    assert.ok(credits * CREDIT_USD >= costUsd(action), `${where}: priced under cost`);
  }
});

test("a longer clip never costs less than a shorter one", () => {
  let previous = 0;
  for (const seconds of [3, 5, 8, 10]) {
    const credits = creditsFor({ kind: "clip", model: "omni", seconds });
    assert.ok(credits >= previous);
    previous = credits;
  }
});

test("the free allowance buys a real week of posts", () => {
  assert.ok(FREE_CREDITS >= 30);
  assert.ok(whatCreditsBuy(FREE_CREDITS).photos >= 30);
  assert.match(creditsBuySentence(FREE_CREDITS), /photos/);
});

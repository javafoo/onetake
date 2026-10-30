import assert from "node:assert/strict";
import test from "node:test";

import { CREDITS_PAGE, PHOTO_CREDITS, creditsWord, decidePaidAction, formatCredits } from "./gate";

const user = { id: "user_1" };

test("a balance that covers the price is allowed, with how many runs it leaves", () => {
  const decision = decidePaidAction({ user, balance: 10, cost: 3, noun: "clip" });
  assert.deepEqual(decision, { allowed: true, cost: 3, balance: 10, runsLeft: 3 });
});

test("a balance short of the price is refused, saying what it costs and what is left", () => {
  const decision = decidePaidAction({ user, balance: 1, cost: 4, noun: "clip" });
  assert.equal(decision.allowed, false);
  if (decision.allowed) return;
  assert.equal(decision.reason, "low_credits");
  assert.equal(decision.shortfall, 3);
  assert.match(decision.detail, /A clip costs 4 credits and you have 1 left/);
  assert.equal(decision.fix.href, CREDITS_PAGE);
});

test("free work is always allowed", () => {
  const decision = decidePaidAction({ user, balance: 0, cost: 0, noun: "carousel" });
  assert.equal(decision.allowed, true);
});

test("credit words read naturally", () => {
  assert.equal(creditsWord(1), "1 credit");
  assert.equal(creditsWord(1200), "1,200 credits");
  assert.equal(formatCredits(-3), "3");
  assert.equal(PHOTO_CREDITS, 1);
});

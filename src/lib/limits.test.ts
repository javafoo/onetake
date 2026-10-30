import assert from "node:assert/strict";
import { test } from "node:test";

import {
  allowanceFor,
  BURST,
  DAY,
  freeUseRefusal,
  HOUR,
  LIMITS,
  limitMessage,
  MINUTE,
  retryAfterMs,
  UNVERIFIED_EMAIL_MESSAGE,
  waitPhrase,
  windowEnd,
  windowStart,
} from "./limits";

const at = (iso: string) => new Date(iso);

test("a window starts on a boundary of its own length", () => {
  assert.equal(windowStart(at("2026-09-21T13:47:31.500Z"), HOUR).toISOString(), "2026-09-21T13:00:00.000Z");
  assert.equal(windowStart(at("2026-09-21T13:47:31.500Z"), DAY).toISOString(), "2026-09-21T00:00:00.000Z");
  assert.equal(windowStart(at("2026-09-21T13:47:31.500Z"), MINUTE).toISOString(), "2026-09-21T13:47:00.000Z");
});

test("every instant inside a window maps to the same start", () => {
  const first = windowStart(at("2026-09-21T00:00:00.000Z"), DAY);
  const last = windowStart(at("2026-09-21T23:59:59.999Z"), DAY);
  assert.equal(first.getTime(), last.getTime());
  // ...and the very next millisecond is the next window.
  assert.notEqual(windowStart(at("2026-09-22T00:00:00.000Z"), DAY).getTime(), first.getTime());
});

test("a window ends exactly where the next one starts", () => {
  const now = at("2026-09-21T13:47:31.500Z");
  for (const length of [MINUTE, HOUR, DAY]) {
    assert.equal(windowEnd(now, length).getTime(), windowStart(now, length).getTime() + length);
    assert.equal(windowEnd(now, length).getTime(), windowStart(windowEnd(now, length), length).getTime());
  }
});

test("the wait is the time to the end of the window, never negative", () => {
  assert.equal(retryAfterMs(at("2026-09-21T13:00:00.000Z"), HOUR), HOUR);
  assert.equal(retryAfterMs(at("2026-09-21T13:59:59.000Z"), HOUR), 1000);
  assert.equal(retryAfterMs(at("2026-09-21T23:00:00.000Z"), DAY), HOUR);
  for (const length of [MINUTE, HOUR, DAY]) {
    assert.ok(retryAfterMs(new Date(), length) > 0);
    assert.ok(retryAfterMs(new Date(), length) <= length);
  }
});

test("the wait is written the way a person would say it", () => {
  assert.equal(waitPhrase(0), "now");
  assert.equal(waitPhrase(1), "in about 1 second");
  assert.equal(waitPhrase(40_000), "in about 40 seconds");
  assert.equal(waitPhrase(3 * MINUTE), "in about 3 minutes");
  assert.equal(waitPhrase(89 * MINUTE), "in about 89 minutes");
  assert.equal(waitPhrase(3 * HOUR), "in about 3 hours");
  assert.equal(waitPhrase(23 * HOUR), "in about 23 hours");
});

test("a plan raises the hook allowance and nothing it does not raise", () => {
  assert.equal(allowanceFor(LIMITS.hooks, false), 20);
  assert.equal(allowanceFor(LIMITS.hooks, true), 100);
  assert.equal(allowanceFor(LIMITS.carousel, false), 30);
  assert.equal(allowanceFor(LIMITS.carousel, true), 30);
  assert.equal(allowanceFor(BURST, false), allowanceFor(BURST, true));
});

test("a free account gets a real taste of the two free features", () => {
  // The paywall is credits, which photos and clips need. These do not.
  assert.ok(LIMITS.hooks.free > 0, "hook writing works with no plan");
  assert.ok(LIMITS.carousel.free > 0, "a carousel set works with no plan");
  assert.ok(LIMITS.reels.free > 0 && LIMITS.reels.withPlan > LIMITS.carousel.withPlan, "reels are the daily thing, and a plan buys many");
});

test("the refusal says what ran out, how much there was, and when it comes back", () => {
  const message = limitMessage(LIMITS.hooks, 20, 3 * HOUR, false);
  assert.match(message, /20 sets of hooks today/);
  assert.match(message, /in about 3 hours/);
  assert.match(message, /A plan raises this to 100 a day/);
  // No accusation, no apology, no jargon.
  assert.doesNotMatch(message, /abuse|suspicious|violation|blocked|banned|429/i);
});

test("an upgrade is only offered where it would change something", () => {
  assert.doesNotMatch(limitMessage(LIMITS.hooks, 100, HOUR, true), /A plan raises/);
  assert.doesNotMatch(limitMessage(LIMITS.carousel, 30, HOUR, false), /A plan raises/);
  assert.doesNotMatch(limitMessage(BURST, BURST.free, 1000, false), /A plan raises/);
});

test("the window is named the way it was measured", () => {
  assert.match(limitMessage(LIMITS.hooks, 20, HOUR, true), /today/);
  assert.match(limitMessage(LIMITS.upload, 60, MINUTE, true), /this hour/);
  assert.match(limitMessage(BURST, BURST.free, 1000, true), /just now/);
});

test("the burst rule is about pace, the named rules about volume", () => {
  /* They answer different questions, so the burst window has to be much
     shorter than any of theirs — otherwise it is just a second daily limit
     with a worse message. */
  for (const rule of Object.values(LIMITS)) {
    assert.ok(BURST.windowMs * 10 <= rule.windowMs, `${rule.bucket}'s window is too close to the burst window`);
  }
  // And the free daily allowance we most want people to reach is inside it,
  // so a person who runs out of hooks hears about hooks.
  assert.ok(LIMITS.hooks.free <= BURST.free);
});

test("every named limit has a distinct bucket", () => {
  const buckets = [...Object.values(LIMITS).map((rule) => rule.bucket), BURST.bucket];
  assert.equal(new Set(buckets).size, buckets.length);
});

test("an account spends the free allowances only with a confirmed email", () => {
  assert.equal(freeUseRefusal(false), UNVERIFIED_EMAIL_MESSAGE);
  assert.equal(freeUseRefusal(true), null);
});

test("the refusal says what to do, in plain words", () => {
  assert.match(UNVERIFIED_EMAIL_MESSAGE, /^Confirm your email address first/);
  assert.match(UNVERIFIED_EMAIL_MESSAGE, /then try again\.$/);
});

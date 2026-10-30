import assert from "node:assert/strict";
import { test } from "node:test";

import { CLIP_ENDPOINT, clipPriceUsd, clipSeconds } from "@/ai/clips";
import { OMNI_MODEL } from "@/ai/omni";
import { creditsFor } from "@/billing/pricing";

import { reservedCostUsd } from "./index";
import { clipModelOf, pricingAction, type ClipJobInput } from "./types";

/* A clip job, from the form all the way to the price. Pure: nothing here
   opens a socket. */

const base: ClipJobInput = { kind: "clip", imageMediaId: "photo", motion: "a small sip", seconds: 5 };

test("a clip job with no model named is an Omni clip, priced by the price list", () => {
  assert.equal(clipModelOf(base), "omni");
  assert.deepEqual(pricingAction(base), { kind: "clip", model: "omni", seconds: 5 });
  assert.equal(creditsFor(pricingAction(base)), 4);
});

test("the cost we hold against the daily cap follows the length", () => {
  const five = reservedCostUsd(base);
  const ten = reservedCostUsd({ ...base, seconds: 10 });
  assert.ok(Math.abs(five - 0.104 * 5) < 1e-9, `held $${five} for five seconds`);
  assert.ok(ten > five, "a longer clip must reserve more, or the cap can be walked past");
});

test("the one model goes to Omni, at its list price", () => {
  assert.equal(CLIP_ENDPOINT.omni, OMNI_MODEL);
  assert.ok(Math.abs((clipPriceUsd(OMNI_MODEL, 5) ?? 0) - 0.52) < 1e-9);
  assert.equal(clipPriceUsd("some-other-model", 5), undefined);
});

test("a duration is clamped to what Omni accepts", () => {
  assert.equal(clipSeconds(1), 3);
  assert.equal(clipSeconds(5), 5);
  assert.equal(clipSeconds(99), 10);
  assert.equal(clipSeconds(undefined), 5);
});

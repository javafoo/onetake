import assert from "node:assert/strict";
import test from "node:test";

import { describeMovement, formatDay, formatDelta, movementLine } from "./history";

test("each ledger reason is said in plain words", () => {
  assert.equal(describeMovement({ reason: "free_grant", delta: 60, jobKind: null }), "Free credits");
  assert.equal(describeMovement({ reason: "job_reserve", delta: -1, jobKind: "image" }), "Photo generated");
  assert.equal(describeMovement({ reason: "job_refund", delta: 4, jobKind: "clip" }), "Clip failed, credits returned");
  assert.equal(describeMovement({ reason: "job_reserve", delta: -1, jobKind: null }), "Generated");
  assert.equal(describeMovement({ reason: "adjustment", delta: 5, jobKind: null }), "Credits added by support");
  assert.equal(describeMovement({ reason: "adjustment", delta: -5, jobKind: null }), "Credits removed by support");
});

test("a delta carries a true minus sign and grouping", () => {
  assert.equal(formatDelta(-3), "−3");
  assert.equal(formatDelta(1200), "+1,200");
  assert.equal(formatDelta(0), "0");
  assert.equal(movementLine({ reason: "job_reserve", delta: -1, jobKind: "image" }), "Photo generated −1");
});

test("a day is written the same on the server and in the browser", () => {
  assert.equal(formatDay(new Date(Date.UTC(2026, 9, 3, 23, 30))), "3 Oct 2026");
});

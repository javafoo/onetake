import assert from "node:assert/strict";
import test from "node:test";

import { cronAuthorised } from "./cron-auth";

test("only the exact bearer secret is the cron", () => {
  const secret = "a".repeat(32);
  assert.equal(cronAuthorised(`Bearer ${secret}`, secret), true);

  // Everything else, including the ways a caller might nearly be right.
  assert.equal(cronAuthorised(null, secret), false);
  assert.equal(cronAuthorised("", secret), false);
  assert.equal(cronAuthorised(secret, secret), false, "no scheme");
  assert.equal(cronAuthorised(`Bearer ${secret}x`, secret), false);
  assert.equal(cronAuthorised("Bearer ", secret), false);
  assert.equal(cronAuthorised(`Basic ${secret}`, secret), false);

  // No secret, or one too short to be one: nobody gets in at all.
  assert.equal(cronAuthorised(`Bearer ${secret}`, undefined), false);
  assert.equal(cronAuthorised("Bearer short", "short"), false);
  assert.equal(cronAuthorised("Bearer ", ""), false);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { ONETAKE_MINUTES_PER_WEEK, timeSaved } from "./time-saved";

test("five posts a week at ninety minutes each", () => {
  const result = timeSaved({ postsPerWeek: 5, minutesPerPost: 90, hourlyValue: 100 });
  // 450 minutes today, less the week's 15 with OneTake: 435 minutes, 7.25 hours.
  assert.equal(result.hoursPerWeek, 7.3);
  assert.equal(result.hoursPerMonth, 31.4);
  assert.equal(result.valuePerMonth, 3142);
  assert.equal(result.daysPerYear, 47);
});

test("no posts saves nothing, and never goes negative", () => {
  assert.deepEqual(timeSaved({ postsPerWeek: 0, minutesPerPost: 90, hourlyValue: 100 }), { hoursPerWeek: 0, hoursPerMonth: 0, valuePerMonth: 0, daysPerYear: 0 });
  assert.equal(timeSaved({ postsPerWeek: 1, minutesPerPost: ONETAKE_MINUTES_PER_WEEK - 5, hourlyValue: 50 }).hoursPerWeek, 0);
});

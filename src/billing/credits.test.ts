import assert from "node:assert/strict";
import test from "node:test";

import { FREE_CREDITS } from "./pricing";
import { ensureFreeCredits, grant, InsufficientCreditsError, refund, reserve, spendableBalance } from "./credits";
import { memoryStore } from "./store.memory";

test("a new account is given its free credits once, however many requests race for them", async () => {
  const store = memoryStore();
  const results = await Promise.all([ensureFreeCredits("u1", store.credits), ensureFreeCredits("u1", store.credits), spendableBalance("u1", store.credits)]);
  assert.equal(results.filter((written) => written === true).length, 1);
  assert.equal(await store.credits.balance("u1"), FREE_CREDITS);
  assert.equal(store.rows.filter((row) => row.reason === "free_grant").length, 1);
});

test("a reservation the balance cannot cover is refused and writes nothing", async () => {
  const store = memoryStore();
  await ensureFreeCredits("u1", store.credits);
  await assert.rejects(reserve("u1", FREE_CREDITS + 1, "job_1", store.credits), InsufficientCreditsError);
  assert.equal(store.rows.filter((row) => row.reason === "job_reserve").length, 0);
});

test("two reservations racing for the last credits cannot both win", async () => {
  const store = memoryStore();
  store.seedLedger({ userId: "u1", delta: 4, reason: "adjustment" });
  const outcomes = await Promise.allSettled([reserve("u1", 4, "job_a", store.credits), reserve("u1", 4, "job_b", store.credits)]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(await store.credits.balance("u1"), 0);
});

test("a refund returns what was reserved, once", async () => {
  const store = memoryStore();
  await ensureFreeCredits("u1", store.credits);
  await reserve("u1", 4, "job_1", store.credits);
  assert.equal(await refund("job_1", store.credits), 4);
  assert.equal(await refund("job_1", store.credits), 0);
  assert.equal(await store.credits.balance("u1"), FREE_CREDITS);
});

test("a grant by hand with a note lands once", async () => {
  const store = memoryStore();
  assert.equal(await grant("u1", 10, "adjustment", "judge", store.credits), true);
  assert.equal(await grant("u1", 10, "adjustment", "judge", store.credits), false);
  assert.equal(await store.credits.balance("u1"), 10);
  await assert.rejects(grant("u1", 0, "adjustment", null, store.credits));
});

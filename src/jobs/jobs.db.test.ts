/* The same claim guarantees as jobs.test.ts, but against real Postgres —
 * because the interesting part of `store.db.ts` is the SQL, and an in-memory
 * fake cannot prove that two HTTP requests reaching two instances of the app
 * are separated by a conditional UPDATE.
 *
 * It skips itself, cleanly and loudly, when there is no DATABASE_URL or the
 * migrations have not been applied. To run it:
 *
 *   pnpm exec tsx --env-file=.env.local --test src/jobs/jobs.db.test.ts
 *
 * It writes only rows belonging to the throwaway user ids below and deletes
 * them afterwards; deleting the user cascades to its jobs, costs and ledger.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { eq, inArray, sql } from "drizzle-orm";

import { db, schema } from "@/db/client";

import { dbJobStore, jobTablesExist } from "./store.db";
import type { StoredJobInput } from "./types";

const PREFIX = "test_jobs_";

const INPUT: StoredJobInput = {
  kind: "clip",
  imageMediaId: "11111111-1111-4111-8111-111111111111",
  motion: "she blinks",
  seconds: 5,
};

let checked: Promise<string | null> | undefined;

/** Null when the database is usable, otherwise why it is not. */
function unavailable(): Promise<string | null> {
  checked ??= (async () => {
    if (!process.env.DATABASE_URL) return "no DATABASE_URL: run with --env-file=.env.local to exercise the real SQL";
    try {
      if (!(await jobTablesExist())) return "the jobs tables are not migrated yet";
      return null;
    } catch (error) {
      return `database unreachable: ${error instanceof Error ? error.message : String(error)}`;
    }
  })();
  return checked;
}

const created: string[] = [];

async function makeUser(): Promise<string> {
  const id = `${PREFIX}${randomUUID()}`;
  await db().insert(schema.users).values({ id, email: `${id}@example.invalid` });
  created.push(id);
  return id;
}

after(async () => {
  // Nothing was written without a database, and db() throws without one: CI has none.
  if (!process.env.DATABASE_URL) return;
  /* `provider_costs` has to go first, and by job id. Deleting the user only
     nulls its user_id and job_id (ON DELETE SET NULL), which would leave the
     row counting against the real daily budget for the rest of the day. */
  for (const userId of created) {
    const jobs = await db().select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.userId, userId));
    const ids = jobs.map((job) => job.id);
    if (ids.length) await db().delete(schema.providerCosts).where(inArray(schema.providerCosts.jobId, ids));
    await db().delete(schema.users).where(eq(schema.users.id, userId));
  }
  /* A run killed before this hook (an outage, a memory error on the dev
     database) leaves rows whose user and job are already nulled out, counting
     against the real daily cap. Every test user id starts with "test_", and a
     cost row remembers its user in meta, so those strays can still be found. */
  await db().execute(sql`delete from provider_costs where user_id is null and job_id is null and meta->>'testUser' like 'test_%'`);
});

test("a repeated requestId inserts one row, whichever call gets there first", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  const userId = await makeUser();
  const requestId = randomUUID();
  const create = () => dbJobStore.create({ userId, avatarId: null, kind: "clip", requestId, input: INPUT, credits: 130 });

  const [a, b] = await Promise.all([create(), create()]);
  assert.equal(a.job.id, b.job.id, "both calls end up with the same job");
  assert.equal([a, b].filter((result) => result.created).length, 1, "exactly one of them created it");

  const rows = await db().select().from(schema.jobs).where(eq(schema.jobs.userId, userId));
  assert.equal(rows.length, 1);
});

test("the claim is a conditional update: of two polls holding the same row, one wins", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  const userId = await makeUser();
  const { job } = await dbJobStore.create({
    userId, avatarId: null, kind: "clip", requestId: randomUUID(), input: INPUT, credits: 130,
  });

  /* Both polls read the row and hold the same `updated_at`. That value is
     stamped by the application, so it survives the round trip to the
     millisecond and can be compared for equality — which is what makes the
     claim work at all. */
  const first = await dbJobStore.find(userId, job.id);
  const second = await dbJobStore.find(userId, job.id);
  assert.ok(first && second);
  assert.equal(first.updatedAt.getTime(), second.updatedAt.getTime());
  assert.equal(first.updatedAt.getTime(), job.updatedAt.getTime(), "what was written comes back unchanged");

  const claim = (updatedAt: Date) =>
    dbJobStore.transition({
      userId, jobId: job.id, from: ["queued"], expectedUpdatedAt: updatedAt, patch: { status: "running" },
    });

  const results = await Promise.all([claim(first.updatedAt), claim(second.updatedAt)]);
  assert.equal(results.filter(Boolean).length, 1, "only one poll may do the work");

  // And the loser cannot claim again with the value it had.
  assert.equal(await claim(first.updatedAt), null);
});

test("the finishing write refuses to replace an output that is already there", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  const userId = await makeUser();
  const { job } = await dbJobStore.create({
    userId, avatarId: null, kind: "clip", requestId: randomUUID(), input: INPUT, credits: 130,
  });
  const running = await dbJobStore.transition({ userId, jobId: job.id, from: ["queued"], patch: { status: "running" } });
  assert.ok(running);

  const finish = (mediaId: string) =>
    dbJobStore.transition({
      userId,
      jobId: job.id,
      from: ["running"],
      requireNoOutput: true,
      patch: { status: "completed", output: { mediaIds: [mediaId], message: "Done." } },
    });

  const winner = await finish("media_a");
  assert.ok(winner);
  assert.equal(await finish("media_b"), null, "a second finisher is refused");

  const stored = await dbJobStore.find(userId, job.id);
  assert.deepEqual(stored?.output?.mediaIds, ["media_a"]);
  assert.equal(stored?.status, "completed");
});

test("the provider status url survives a round trip through the input blob", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  const userId = await makeUser();
  const { job } = await dbJobStore.create({
    userId, avatarId: null, kind: "clip", requestId: randomUUID(), input: INPUT, credits: 130,
  });
  await dbJobStore.transition({
    userId,
    jobId: job.id,
    from: ["queued"],
    patch: {
      status: "running",
      provider: "google",
      providerRequestId: "req_db_test",
      input: { ...INPUT, providerStatusUrl: "https://example.invalid/req_db_test" },
    },
  });

  const stored = await dbJobStore.find(userId, job.id);
  assert.equal(stored?.providerRequestId, "req_db_test");
  assert.equal(stored?.input.providerStatusUrl, "https://example.invalid/req_db_test");
  assert.equal(stored?.input.kind, "clip");
});

test("costs are recorded, settled once, and counted towards today", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  const userId = await makeUser();
  const { job } = await dbJobStore.create({
    userId, avatarId: null, kind: "image", requestId: randomUUID(), input: { kind: "image", idea: "x", shot: "selfie", aspectRatio: "3:4" }, credits: 45,
  });

  const before = await dbJobStore.spentTodayUsd(new Date());
  const held = await dbJobStore.reserveCost(
    { userId, jobId: job.id, provider: "gemini", model: "test", kind: "image", costUsd: 0.268 },
    before + 1000,
  );
  assert.equal(held.ok, true);
  const reserved = await dbJobStore.spentTodayUsd(new Date());
  assert.ok(Math.abs(reserved - before - 0.268) < 1e-6, "a reservation counts against the day straight away");

  await dbJobStore.settleCost({ jobId: job.id, status: "done", costUsd: 0.134, meta: { estimate: false } });
  const settled = await dbJobStore.spentTodayUsd(new Date());
  assert.ok(Math.abs(settled - before - 0.134) < 1e-6, "settling replaces the estimate with the real figure");

  // Settling again must not touch a row that is already done.
  await dbJobStore.settleCost({ jobId: job.id, status: "refunded" });
  const again = await dbJobStore.spentTodayUsd(new Date());
  assert.ok(Math.abs(again - settled) < 1e-6);
});


test("the cap check and the cost row are one atomic step", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  const userId = await makeUser();
  const spent = await dbJobStore.spentTodayUsd(new Date());
  /* Room for exactly four more reservations of 0.25, whatever else the day has
     already seen. Ten callers race for them; six have to lose. */
  const cap = spent + 1;

  const jobs = await Promise.all(
    Array.from({ length: 10 }, async () => {
      const { job } = await dbJobStore.create({
        userId, avatarId: null, kind: "image", requestId: randomUUID(),
        input: { kind: "image", idea: "x", shot: "selfie", aspectRatio: "3:4" }, credits: 0,
      });
      return job.id;
    }),
  );

  const held = await Promise.all(
    jobs.map((jobId) =>
      dbJobStore.reserveCost({ userId, jobId, provider: "gemini", model: "test", kind: "image", costUsd: 0.25 }, cap)),
  );
  const won = held.filter((result) => result.ok).length;

  assert.equal(won, 4, "exactly four reservations of 0.25 fit in a dollar of headroom");
  const after = await dbJobStore.spentTodayUsd(new Date());
  assert.ok(after <= cap + 1e-6, `the day never went past the cap (${after} vs ${cap})`);
});

test("credits() reads the ledger, so a reserve and its refund cancel out", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  const userId = await makeUser();
  const { job } = await dbJobStore.create({
    userId, avatarId: null, kind: "clip", requestId: randomUUID(), input: INPUT, credits: 130,
  });

  await db().insert(schema.creditLedger).values({ userId, delta: -130, reason: "job_reserve", jobId: job.id });
  assert.deepEqual(await dbJobStore.credits(job.id), { reserved: 130, refunded: 0 });

  await db().insert(schema.creditLedger).values({ userId, delta: 130, reason: "job_refund", jobId: job.id });
  assert.deepEqual(await dbJobStore.credits(job.id), { reserved: 130, refunded: 130 });
});

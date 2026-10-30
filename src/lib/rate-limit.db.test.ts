/* The rate limiter's SQL, against real Postgres.
 *
 * The window arithmetic is tested in limits.test.ts with no database. What
 * needs a real one is the only thing an in-memory fake cannot show: that a
 * hundred concurrent calls cannot all read "under the cap" and all write.
 *
 *   pnpm exec tsx --env-file=.env.local --test src/lib/rate-limit.db.test.ts
 *
 * Every row belongs to a throwaway `test_` user, deleted afterwards.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { eq, sql } from "drizzle-orm";

import { db, schema } from "@/db/client";

import { DAY, MINUTE, windowStart, type LimitRule } from "./limits";
import { consume, RateLimitedError, requireWithinLimit, sweepRateLimits } from "./rate-limit";

const PREFIX = "test_limit_";

let checked: Promise<string | null> | undefined;

function unavailable(): Promise<string | null> {
  checked ??= (async () => {
    if (!process.env.DATABASE_URL) return "no DATABASE_URL: run with --env-file=.env.local to exercise the real SQL";
    try {
      const { rows } = await db().execute<{ present: number }>(sql`
        select count(*)::int as present from information_schema.tables
        where table_schema = 'public' and table_name = 'rate_limits'
      `);
      return Number(rows[0]?.present ?? 0) === 1 ? null : "rate_limits is not migrated yet";
    } catch (error) {
      return `database unreachable: ${error instanceof Error ? error.message : String(error)}`;
    }
  })();
  return checked;
}

async function withUser(
  patch: Partial<typeof schema.users.$inferInsert>,
  body: (user: { id: string; plan: never; planStatus: never }) => Promise<void>,
): Promise<void> {
  const id = `${PREFIX}${randomUUID()}`;
  const [row] = await db()
    .insert(schema.users)
    .values({ id, email: `${id}@example.invalid`, ...patch })
    .returning();
  try {
    await body(row as never);
  } finally {
    await db().delete(schema.users).where(eq(schema.users.id, id));
  }
}

/** A rule of this test's own, so a real limit can be changed without breaking these. */
const rule = (limit: number, windowMs = DAY): LimitRule => ({
  bucket: `test_${randomUUID()}`,
  noun: "things",
  free: limit,
  withPlan: limit,
  windowMs,
});

test("a hundred concurrent calls consume exactly the allowance", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withUser({}, async (user) => {
    const bucket = rule(20);
    const results = await Promise.all(Array.from({ length: 100 }, () => consume(user.id, bucket, 20)));

    assert.equal(results.filter((r) => r.allowed).length, 20, "exactly twenty got through");
    const { rows } = await db().execute<{ count: number }>(
      sql`select count from rate_limits where user_id = ${user.id} and bucket = ${bucket.bucket}`,
    );
    assert.equal(Number(rows[0].count), 20, "and the row was never pushed past the cap");
  });
});

test("what is left counts down, and the last one is still allowed", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withUser({}, async (user) => {
    const bucket = rule(3);
    const first = await consume(user.id, bucket, 3);
    assert.equal(first.allowed, true);
    assert.equal(first.remaining, 2);
    const second = await consume(user.id, bucket, 3);
    assert.equal(second.remaining, 1);
    const third = await consume(user.id, bucket, 3);
    assert.equal(third.allowed, true);
    assert.equal(third.remaining, 0, "the last one is allowed and leaves nothing");
    const fourth = await consume(user.id, bucket, 3);
    assert.equal(fourth.allowed, false);
    assert.ok(fourth.retryAfterMs > 0, "and it says when to come back");
  });
});

test("a new window starts a new count", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withUser({}, async (user) => {
    const bucket = rule(2, MINUTE);
    const today = new Date("2026-09-21T10:00:30.000Z");
    const later = new Date("2026-09-21T10:01:05.000Z");

    assert.equal((await consume(user.id, bucket, 2, { now: today })).allowed, true);
    assert.equal((await consume(user.id, bucket, 2, { now: today })).allowed, true);
    assert.equal((await consume(user.id, bucket, 2, { now: today })).allowed, false);
    assert.equal((await consume(user.id, bucket, 2, { now: later })).allowed, true, "the next minute is a clean slate");
  });
});

test("a cost larger than the whole allowance is refused and counts nothing", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withUser({}, async (user) => {
    const bucket = rule(10);
    const refused = await consume(user.id, bucket, 10, { cost: 15 });
    assert.equal(refused.allowed, false);
    // ...and the allowance is untouched, so a legitimate call still works.
    assert.equal((await consume(user.id, bucket, 10, { cost: 10 })).allowed, true);
  });
});

test("each account has its own allowance", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withUser({}, async (first) => {
    await withUser({}, async (second) => {
      /* A fixed instant, so a minute boundary cannot roll the burst window
         over in the middle of the loop and change which rule refuses. */
      const now = new Date("2026-09-21T12:30:00.000Z");
      for (let i = 0; i < 30; i++) await requireWithinLimit(first as never, "hooks", { now });
      await assert.rejects(() => requireWithinLimit(first as never, "hooks", { now }), RateLimitedError);

      // The other account is untouched by any of that.
      await requireWithinLimit(second as never, "hooks", { now });
    });
  });
});

test("being refused by a daily limit does not spend the burst allowance", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withUser({}, async (user) => {
    /* Ten rebuilds is the daily limit and thirty a minute is the burst limit,
       so the eleventh rebuild is refused by the daily rule. That refusal must
       not also take a burst slot, or a refused person would be locked out of
       everything else for a minute. */
    const now = new Date("2026-09-21T12:30:00.000Z");
    for (let i = 0; i < 10; i++) await requireWithinLimit(user as never, "brief", { now });
    await assert.rejects(() => requireWithinLimit(user as never, "brief", { now }), RateLimitedError);
    await assert.rejects(() => requireWithinLimit(user as never, "brief", { now }), RateLimitedError);

    const { rows } = await db().execute<{ count: number }>(
      sql`select count from rate_limits where user_id = ${user.id} and bucket = 'burst'`,
    );
    assert.equal(Number(rows[0].count), 10, "only the ten that were allowed took a burst slot");
  });
});

test("the burst rule catches a run that the daily rule would not", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withUser({}, async (user) => {
    // A hundred a day, but thirty a minute: this is the shape of a script.
    const now = new Date("2026-09-21T12:30:00.000Z");
    for (let i = 0; i < 30; i++) await requireWithinLimit(user as never, "hooks", { now });
    await assert.rejects(() => requireWithinLimit(user as never, "hooks", { now }), (error: unknown) => {
      assert.ok(error instanceof RateLimitedError);
      assert.equal(error.bucket, "burst");
      assert.match(error.message, /just now/);
      return true;
    });
  });
});

test("the sweep takes away windows that are over and leaves live ones", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withUser({}, async (user) => {
    const bucket = rule(5, MINUTE);
    /* A fixed "live" instant, so the window under test cannot become a
       finished one between the write and the sweep. */
    const live = new Date(Date.now() + 5 * 60 * 1000);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await consume(user.id, bucket, 5, { now: old });
    await consume(user.id, bucket, 5, { now: live });

    await sweepRateLimits();
    const { rows } = await db().execute<{ window_start: string }>(
      sql`select window_start from rate_limits where user_id = ${user.id} and bucket = ${bucket.bucket}`,
    );
    assert.equal(rows.length, 1, "the finished window is gone and the live one is not");
    assert.equal(new Date(rows[0].window_start).getTime(), windowStart(live, MINUTE).getTime());
  });
});

test("deleting an account takes its counters with it", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  const id = `${PREFIX}${randomUUID()}`;
  await db().insert(schema.users).values({ id, email: `${id}@example.invalid` });
  await consume(id, rule(5), 5);
  await db().delete(schema.users).where(eq(schema.users.id, id));

  const { rows } = await db().execute(sql`select 1 from rate_limits where user_id = ${id}`);
  assert.equal(rows.length, 0);
});

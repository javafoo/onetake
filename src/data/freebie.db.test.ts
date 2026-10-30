/* The free photo's state machine, against real Postgres.
 *
 * The whole promise is "exactly one, ever", and the only interesting way to
 * break it is two taps arriving at once. An in-memory fake cannot prove that
 * the conditional UPDATE is what serialises them, so this runs the real SQL.
 *
 * It skips itself, cleanly and loudly, when there is no DATABASE_URL or the
 * column has not been migrated yet. To run it:
 *
 *   pnpm exec tsx --env-file=.env.local --test src/data/freebie.db.test.ts
 *
 * It writes only rows belonging to the throwaway user ids below and deletes
 * them afterwards.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { eq, sql } from "drizzle-orm";

import { db, schema } from "@/db/client";

import { claimFreePhoto, freePhotoState, releaseFreePhoto } from "./freebie";

const PREFIX = "test_freebie_";

let checked: Promise<string | null> | undefined;

/** Null when the database is usable, otherwise why it is not. */
function unavailable(): Promise<string | null> {
  checked ??= (async () => {
    if (!process.env.DATABASE_URL) return "no DATABASE_URL: run with --env-file=.env.local to exercise the real SQL";
    try {
      const { rows } = await db().execute<{ n: string }>(sql`
        select count(*) as n from information_schema.columns
        where table_name = 'users' and column_name = 'free_photo_used_at'
      `);
      return Number(rows[0].n) === 1 ? null : "users.free_photo_used_at is not migrated yet";
    } catch (error) {
      return `database unreachable: ${error instanceof Error ? error.message : String(error)}`;
    }
  })();
  return checked;
}

async function withUser(body: (userId: string) => Promise<void>): Promise<void> {
  const id = `${PREFIX}${randomUUID()}`;
  await db().insert(schema.users).values({ id, email: `${id}@example.invalid` });
  try {
    await body(id);
  } finally {
    await db().delete(schema.users).where(eq(schema.users.id, id));
  }
}

/* ------------------------------------------------------------------ */
/* Unused -> used, exactly once                                        */
/* ------------------------------------------------------------------ */

test("a new account has its free photo, and one claim takes it", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withUser(async (userId) => {
    assert.deepEqual(await freePhotoState(userId), { available: true, usedAt: null });

    const claimedAt = await claimFreePhoto(userId);
    assert.ok(claimedAt instanceof Date, "the first claim gets the timestamp it wrote");

    const after = await freePhotoState(userId);
    assert.equal(after.available, false);
    assert.equal(after.usedAt?.getTime(), claimedAt.getTime());
  });
});

test("a second claim is refused, and does not move the timestamp", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withUser(async (userId) => {
    const first = await claimFreePhoto(userId);
    assert.ok(first);

    const second = await claimFreePhoto(userId);
    assert.equal(second, null, "the freebie is gone, so the second attempt gets nothing");

    /* And the record still points at the claim that actually won, which is
       what the failure path releases against. */
    assert.equal((await freePhotoState(userId)).usedAt?.getTime(), first.getTime());
  });
});

test("two concurrent claims: exactly one wins", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withUser(async (userId) => {
    /* The case the whole design exists for: two taps, two requests, no
       coordination between them. The conditional UPDATE is the only thing
       standing between this and two free photos. */
    const [a, b] = await Promise.all([claimFreePhoto(userId), claimFreePhoto(userId)]);

    const won = [a, b].filter((result) => result !== null);
    assert.equal(won.length, 1, `exactly one claim should win, got ${won.length}`);
    assert.equal((await freePhotoState(userId)).usedAt?.getTime(), won[0]!.getTime());
  });
});

test("eight concurrent claims: still exactly one wins", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withUser(async (userId) => {
    const results = await Promise.all(Array.from({ length: 8 }, () => claimFreePhoto(userId)));
    assert.equal(results.filter((result) => result !== null).length, 1);
    assert.equal((await freePhotoState(userId)).available, false);
  });
});

/* ------------------------------------------------------------------ */
/* Releasing it again                                                  */
/* ------------------------------------------------------------------ */

test("a released claim makes the freebie available again, exactly once", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withUser(async (userId) => {
    const claimedAt = await claimFreePhoto(userId);
    assert.ok(claimedAt);

    assert.equal(await releaseFreePhoto(userId, claimedAt), true);
    assert.equal((await freePhotoState(userId)).available, true);

    /* Idempotent: the poll route runs this on every poll of the same failed
       job, and the second one must write nothing. */
    assert.equal(await releaseFreePhoto(userId, claimedAt), false);
  });
});

test("a release cannot undo a claim it does not own", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withUser(async (userId) => {
    const first = await claimFreePhoto(userId);
    assert.ok(first);
    await releaseFreePhoto(userId, first);

    // Somebody claimed it again in between — a retry after a failed job.
    const second = await claimFreePhoto(userId);
    assert.ok(second);

    /* The stale release, arriving late from the first failed job's poll. It
       must not hand back a gift that is currently being spent. */
    assert.equal(await releaseFreePhoto(userId, first), false);
    assert.equal((await freePhotoState(userId)).available, false, "the live claim survives a stale release");
  });
});

test("a claim and a concurrent release of an older claim cannot both succeed", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withUser(async (userId) => {
    const stale = new Date("2020-01-01T00:00:00.000Z");
    const [claimed, released] = await Promise.all([claimFreePhoto(userId), releaseFreePhoto(userId, stale)]);
    assert.ok(claimed, "the claim wins because the column was null");
    assert.equal(released, false, "the stale release matches nothing");
    assert.equal((await freePhotoState(userId)).available, false);
  });
});

test("an account that does not exist has no freebie to give", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  const missing = `${PREFIX}${randomUUID()}`;
  assert.deepEqual(await freePhotoState(missing), { available: false, usedAt: null });
  assert.equal(await claimFreePhoto(missing), null);
});

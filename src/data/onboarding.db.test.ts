/* The legacy-account rescue, against real Postgres.
 *
 * `backfillOnboarded` exists so an account that predates the setup interview is
 * not marched through one. It reads four tables, so the interesting part is the
 * SQL and the order of the checks, not the arithmetic — and the one thing it
 * must not do is rescue an account that is still in the middle of setup.
 *
 * That is not a hypothetical. The review screen saves the brand profile, and
 * from that moment the account has a lock, references and a complete profile,
 * which is exactly the shape of a legacy account. Without the session guard the
 * next render marks it onboarded and the gate bounces it off the last screen of
 * setup, so nobody ever sees the free photo.
 *
 * Run it with: pnpm exec tsx --env-file=.env.local --test src/data/onboarding.db.test.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { eq, sql } from "drizzle-orm";

import { db, schema } from "@/db/client";

import { backfillOnboarded, saveSession, completeSession } from "./onboarding";
import { start } from "@/onboarding/state";

const PREFIX = "test_onboarding_";

let checked: Promise<string | null> | undefined;

function unavailable(): Promise<string | null> {
  checked ??= (async () => {
    if (!process.env.DATABASE_URL) return "no DATABASE_URL: run with --env-file=.env.local to exercise the real SQL";
    try {
      await db().execute(sql`select 1`);
      return null;
    } catch (error) {
      return `database unreachable: ${error instanceof Error ? error.message : String(error)}`;
    }
  })();
  return checked;
}

const PROFILE = {
  personaName: "Test",
  niche: "faceless marketing",
  audience: "women in a 9-5",
  offer: "a starter kit",
  keyword: "KIT",
  story: "",
  voice: "",
  proofPoints: [],
  winners: [],
};

/** An account with everything setup produces, and a null onboarded_at. */
async function withSetUpAccount(body: (userId: string) => Promise<void>): Promise<void> {
  const userId = `${PREFIX}${randomUUID()}`;
  await db().insert(schema.users).values({ id: userId, email: `${userId}@example.invalid` });
  try {
    const [avatar] = await db()
      .insert(schema.avatars)
      .values({ userId, name: "Her", kind: "avatar", lock: { subject: "her", scenes: ["a kitchen table"] } })
      .returning({ id: schema.avatars.id });

    const [media] = await db()
      .insert(schema.media)
      .values({ userId, avatarId: avatar.id, kind: "upload", pathname: `users/${userId}/upload/x.jpg`, contentType: "image/jpeg", bytes: 10 })
      .returning({ id: schema.media.id });

    await db()
      .insert(schema.avatarReferences)
      .values({ avatarId: avatar.id, mediaId: media.id, role: "front", source: "original", approved: true, position: 0 });

    await db().insert(schema.brandProfiles).values({ avatarId: avatar.id, userId, profile: PROFILE });

    await body(userId);
  } finally {
    await db().delete(schema.users).where(eq(schema.users.id, userId));
  }
}

const onboardedAt = async (userId: string) => {
  const { rows } = await db().execute<{ v: string | null }>(sql`select onboarded_at as v from users where id = ${userId}`);
  return rows[0]?.v ?? null;
};

test("an account that predates the interview is rescued, once", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withSetUpAccount(async (userId) => {
    // No onboarding_sessions row at all: this is what a legacy account looks like.
    const at = await backfillOnboarded(userId);
    assert.ok(at instanceof Date, "an account with all the pieces and no session should be rescued");
    assert.ok(await onboardedAt(userId), "and the column should be written");
  });
});

test("an account still inside setup is left alone, however much it already owns", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withSetUpAccount(async (userId) => {
    /* The state right after the review screen is submitted: every piece is
       present and the session is still open, because the last screen has not
       been passed yet. */
    await saveSession(userId, {
      stage: "first-photo",
      interview: start({ avatarKind: "avatar", personaName: "Her", niche: "faceless marketing" }),
      ui: { avatarId: null },
    });

    assert.equal(await backfillOnboarded(userId), null, "an open session means the flow decides, not the backfill");
    assert.equal(await onboardedAt(userId), null, "and nothing is written, so the last screen stays reachable");
  });
});

test("once the session is completed, the same account is rescued again", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withSetUpAccount(async (userId) => {
    await saveSession(userId, {
      stage: "first-photo",
      interview: start({ avatarKind: "avatar", personaName: "Her", niche: "faceless marketing" }),
      ui: { avatarId: null },
    });
    assert.equal(await backfillOnboarded(userId), null);

    /* `completeSession` is what the button on the last screen calls. After it,
       an account with a null onboarded_at really is one the rescue is for. */
    await completeSession(userId);
    assert.ok(await backfillOnboarded(userId), "a finished session no longer blocks the rescue");
  });
});

test("a half-built account is not rescued, session or no session", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  const userId = `${PREFIX}${randomUUID()}`;
  await db().insert(schema.users).values({ id: userId, email: `${userId}@example.invalid` });
  try {
    // No avatar, so nothing setup would have produced.
    assert.equal(await backfillOnboarded(userId), null);
    assert.equal(await onboardedAt(userId), null);
  } finally {
    await db().delete(schema.users).where(eq(schema.users.id, userId));
  }
});

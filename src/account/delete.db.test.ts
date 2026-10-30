/* Account erasure, against the real database and the filesystem storage.
 *
 * The interesting parts cannot be faked: that deleting one row takes eight
 * tables with it, that the blob prefix really is emptied, that a second
 * delivery of the same webhook does nothing, and that one account's deletion
 * leaves the account next to it untouched.
 *
 *   pnpm exec tsx --env-file=.env.local --test src/account/delete.db.test.ts
 *
 * It creates its own throwaway `test_` users and deletes them afterwards. The
 * long-lived test accounts are never touched.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { eq, sql } from "drizzle-orm";

import { db, schema } from "@/db/client";
import { saveMedia } from "@/data/media";
import { userPrefix } from "@/lib/storage";

import { deleteAccountData } from "./delete";

const PREFIX = "test_delete_";

let storageRoot: string;
let previousDriver: string | undefined;
let previousRoot: string | undefined;

before(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), "delete-test-"));
  previousDriver = process.env.STORAGE_DRIVER;
  previousRoot = process.env.STORAGE_FS_ROOT;
  process.env.STORAGE_DRIVER = "fs";
  process.env.STORAGE_FS_ROOT = storageRoot;
});

after(async () => {
  if (previousDriver === undefined) delete process.env.STORAGE_DRIVER;
  else process.env.STORAGE_DRIVER = previousDriver;
  if (previousRoot === undefined) delete process.env.STORAGE_FS_ROOT;
  else process.env.STORAGE_FS_ROOT = previousRoot;
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
});

let checked: Promise<string | null> | undefined;

function unavailable(): Promise<string | null> {
  checked ??= (async () => {
    if (!process.env.DATABASE_URL) return "no DATABASE_URL: run with --env-file=.env.local to exercise the real SQL";
    try {
      const { rows } = await db().execute<{ present: number }>(sql`
        select count(*)::int as present from information_schema.tables
        where table_schema = 'public'
          and table_name in ('users', 'avatars', 'media', 'drafts', 'jobs', 'credit_ledger',
                             'onboarding_sessions', 'brand_profiles', 'rate_limits', 'safety_refusals')
      `);
      return Number(rows[0]?.present ?? 0) === 10 ? null : "the schema is not fully migrated yet";
    } catch (error) {
      return `database unreachable: ${error instanceof Error ? error.message : String(error)}`;
    }
  })();
  return checked;
}

/** A whole account with a row in every table erasure has to reach. */
async function makeAccount(): Promise<{ userId: string; avatarId: string; mediaIds: string[] }> {
  const userId = `${PREFIX}${randomUUID()}`;
  await db().insert(schema.users).values({ id: userId, email: `${userId}@example.invalid` });

  const [avatar] = await db()
    .insert(schema.avatars)
    .values({ userId, name: "Test", kind: "avatar", lock: { subject: "x" } })
    .returning({ id: schema.avatars.id });

  const mediaIds: string[] = [];
  for (const kind of ["upload", "image", "clip"] as const) {
    const row = await saveMedia(userId, {
      kind,
      avatarId: avatar.id,
      data: Buffer.from(`bytes-${kind}-${randomUUID()}`),
      contentType: kind === "clip" ? "video/mp4" : "image/jpeg",
    });
    mediaIds.push(row.id);
  }

  await db().insert(schema.avatarReferences).values({
    avatarId: avatar.id, mediaId: mediaIds[0], role: "front", source: "original", position: 0,
  });
  await db().insert(schema.brandProfiles).values({ avatarId: avatar.id, userId, profile: { niche: "x" } });
  await db().insert(schema.onboardingSessions).values({ userId, step: "welcome", state: {} });
  await db().insert(schema.drafts).values({ userId, avatarId: avatar.id, hook: "a hook" });
  const [job] = await db()
    .insert(schema.jobs)
    .values({ userId, kind: "image", requestId: randomUUID(), input: {}, credits: 45 })
    .returning({ id: schema.jobs.id });
  await db().insert(schema.creditLedger).values({ userId, delta: 500, reason: "adjustment" });
  await db().insert(schema.creditLedger).values({ userId, delta: -45, reason: "job_reserve", jobId: job.id });
  await db().insert(schema.rateLimits).values({
    userId, bucket: "hooks", windowStart: new Date(), count: 3, expiresAt: new Date(Date.now() + 86_400_000),
  });
  await db().insert(schema.safetyRefusals).values({ userId, stage: "upload", reason: "apparent_minor" });
  await db().insert(schema.providerCosts).values({
    userId, jobId: job.id, provider: "gemini", model: "image", kind: "image", costUsd: "0.1340",
  });

  return { userId, avatarId: avatar.id, mediaIds };
}

/** Every row anywhere that still names this user. */
async function rowsFor(userId: string): Promise<Record<string, number>> {
  const tables = [
    "users", "avatars", "media", "avatar_references", "brand_profiles",
    "onboarding_sessions", "drafts", "jobs", "credit_ledger", "rate_limits", "safety_refusals",
  ];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const column = table === "users" ? "id" : "user_id";
    // avatar_references has neither: it hangs off the avatar.
    const query =
      table === "avatar_references"
        ? sql`select count(*)::int as n from avatar_references r
              join avatars a on a.id = r.avatar_id where a.user_id = ${userId}`
        : sql`select count(*)::int as n from ${sql.raw(table)} where ${sql.raw(column)} = ${userId}`;
    const { rows } = await db().execute<{ n: number }>(query);
    counts[table] = Number(rows[0]?.n ?? 0);
  }
  return counts;
}

async function storedFiles(userId: string): Promise<number> {
  const walk = async (dir: string): Promise<number> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    let total = 0;
    for (const entry of entries) {
      total += entry.isDirectory() ? await walk(join(dir, entry.name)) : 1;
    }
    return total;
  };
  return walk(join(storageRoot, userPrefix(userId)));
}

async function cleanUp(userId: string): Promise<void> {
  await db().delete(schema.users).where(eq(schema.users.id, userId));
}

test("deleting an account takes every row and every file with it", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  const account = await makeAccount();
  try {
    const before = await rowsFor(account.userId);
    for (const [table, count] of Object.entries(before)) {
      assert.ok(count > 0, `${table} should have something to delete`);
    }
    // Three media rows, and the sidecar the filesystem store writes beside each.
    assert.equal(await storedFiles(account.userId), 6);

    const result = await deleteAccountData(account.userId);
    assert.equal(result.existed, true);
    assert.equal(result.media, 3);

    const after = await rowsFor(account.userId);
    for (const [table, count] of Object.entries(after)) {
      assert.equal(count, 0, `${table} still has rows`);
    }
    assert.equal(await storedFiles(account.userId), 0, "the blob prefix is empty");
  } finally {
    await cleanUp(account.userId);
  }
});

test("the accounting record survives, with nobody's name on it", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  const account = await makeAccount();
  try {
    await deleteAccountData(account.userId);
    const { rows } = await db().execute<{ n: number; named: number }>(sql`
      select count(*)::int as n, count(user_id)::int as named
      from provider_costs where kind = 'image' and model = 'image' and user_id is null
    `);
    assert.ok(Number(rows[0].n) >= 1, "what the generation cost us is still on file");
    assert.equal(Number(rows[0].named), 0, "and it no longer names anybody");
  } finally {
    await cleanUp(account.userId);
  }
});

test("deleting twice is not an error, and the second time finds nothing", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  const account = await makeAccount();
  try {
    assert.equal((await deleteAccountData(account.userId)).existed, true);
    // A webhook is delivered more than once, and the self-serve flow fires one too.
    const second = await deleteAccountData(account.userId);
    assert.equal(second.existed, false);
    assert.equal(second.media, 0);
    // And a user id that never existed is simply a no-op.
    assert.equal((await deleteAccountData(`${PREFIX}${randomUUID()}`)).existed, false);
  } finally {
    await cleanUp(account.userId);
  }
});

test("one account's deletion does not touch the account next to it", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  const going = await makeAccount();
  const staying = await makeAccount();
  try {
    await deleteAccountData(going.userId);

    const after = await rowsFor(staying.userId);
    for (const [table, count] of Object.entries(after)) {
      assert.ok(count > 0, `${table} lost rows belonging to the other account`);
    }
    assert.equal(await storedFiles(staying.userId), 6, "the other account's files are all still there");
  } finally {
    await cleanUp(going.userId);
    await cleanUp(staying.userId);
  }
});

test("a deletion refuses an empty user id rather than matching everything", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);
  await assert.rejects(() => deleteAccountData(""), /needs a user id/);
});

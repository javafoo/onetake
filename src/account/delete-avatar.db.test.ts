/* Deleting one avatar, against the real database and the filesystem storage.
 *
 * What cannot be faked: that her rows go with the avatar row, that her files
 * really leave storage, and that the avatar beside her, her account and its
 * credits are untouched.
 *
 *   pnpm exec tsx --env-file=.env.local --test src/account/delete-avatar.db.test.ts
 *
 * Throwaway `test_` users only, deleted afterwards.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { eq, sql } from "drizzle-orm";

import { db, schema } from "@/db/client";
import { deleteAvatar } from "@/data/avatars";
import { avatarPathnames, saveMedia } from "@/data/media";
import { getStorage } from "@/lib/get-storage";

import { eraseAvatar } from "./delete-avatar";

const PREFIX = "test_delavatar_";
let storageRoot: string;
let previousDriver: string | undefined;
let previousRoot: string | undefined;

before(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), "delete-avatar-test-"));
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

async function unavailable(): Promise<string | null> {
  if (!process.env.DATABASE_URL) return "no DATABASE_URL: run with --env-file=.env.local to exercise the real SQL";
  try {
    const { rows } = await db().execute<{ n: number }>(sql`
      select count(*)::int as n from information_schema.tables
      where table_schema = 'public' and table_name in ('users', 'avatars', 'media', 'drafts', 'brand_profiles', 'hooks', 'credit_ledger')
    `);
    return Number(rows[0]?.n ?? 0) === 7 ? null : "the schema is not fully migrated yet";
  } catch (error) {
    return `database unreachable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** One avatar with photos, a clip, a reel, a slide, a reference, a brand, a draft and a hook. */
async function stocked(userId: string, name: string): Promise<{ avatarId: string; pathnames: string[] }> {
  const [avatar] = await db().insert(schema.avatars).values({ userId, name, kind: "avatar" }).returning({ id: schema.avatars.id });
  const pathnames: string[] = [];
  const ids: string[] = [];
  for (const kind of ["upload", "image", "image", "clip", "reel", "slide"] as const) {
    const row = await saveMedia(userId, { kind, avatarId: avatar.id, data: Buffer.from(`${name}-${kind}-${randomUUID()}`), contentType: kind === "clip" || kind === "reel" ? "video/mp4" : "image/png" });
    pathnames.push(row.pathname);
    ids.push(row.id);
  }
  await db().insert(schema.avatarReferences).values({ avatarId: avatar.id, mediaId: ids[0], role: "front", source: "original", position: 0 });
  await db().insert(schema.brandProfiles).values({ avatarId: avatar.id, userId, profile: { niche: name } });
  await db().insert(schema.drafts).values({ userId, avatarId: avatar.id, hook: `${name} hook` });
  await db().insert(schema.hooks).values({ userId, avatarId: avatar.id, text: `${name} saved hook` });
  return { avatarId: avatar.id, pathnames };
}

const exists = (pathname: string) => access(join(storageRoot, pathname)).then(() => true, () => false);

async function countFor(table: "media" | "drafts" | "brand_profiles" | "hooks", avatarId: string): Promise<number> {
  const { rows } = await db().execute<{ n: number }>(sql`select count(*)::int as n from ${sql.raw(table)} where avatar_id = ${avatarId}`);
  return Number(rows[0]?.n ?? 0);
}

test("deleting one avatar takes her rows and files and leaves the other avatar, the account and its credits", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  const userId = `${PREFIX}${randomUUID()}`;
  await db().insert(schema.users).values({ id: userId, email: `${userId}@example.invalid` });
  try {
    await db().insert(schema.creditLedger).values({ userId, delta: 70, reason: "adjustment" });
    const gone = await stocked(userId, "Gone");
    const kept = await stocked(userId, "Kept");
    for (const pathname of [...gone.pathnames, ...kept.pathnames]) assert.ok(await exists(pathname), `stored: ${pathname}`);

    const storage = getStorage();
    const deps = { pathnames: avatarPathnames, deleteObject: (pathname: string) => storage.delete(pathname), deleteRow: deleteAvatar };
    const result = await eraseAvatar(userId, gone.avatarId, deps);
    assert.deepEqual(result, { existed: true, objects: gone.pathnames.length });

    for (const table of ["media", "drafts", "brand_profiles", "hooks"] as const) {
      assert.equal(await countFor(table, gone.avatarId), 0, `her ${table} are gone`);
      assert.ok((await countFor(table, kept.avatarId)) > 0, `the other avatar's ${table} stay`);
    }
    for (const pathname of gone.pathnames) assert.equal(await exists(pathname), false, `file removed: ${pathname}`);
    for (const pathname of kept.pathnames) assert.equal(await exists(pathname), true, `other avatar's file kept: ${pathname}`);

    const [account] = await db().select().from(schema.users).where(eq(schema.users.id, userId));
    assert.ok(account, "the account stays");
    const { rows } = await db().execute<{ n: number }>(sql`select coalesce(sum(delta), 0)::int as n from credit_ledger where user_id = ${userId}`);
    assert.equal(Number(rows[0]?.n), 70, "and so do its credits");

    // A second attempt finds nothing and does nothing.
    assert.deepEqual(await eraseAvatar(userId, gone.avatarId, deps), { existed: false, objects: 0 });
  } finally {
    await db().delete(schema.users).where(eq(schema.users.id, userId));
  }
});

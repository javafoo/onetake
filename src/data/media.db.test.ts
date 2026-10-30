/* The upload cap, against real Postgres.
 *
 * The interesting part is the SQL: an in-memory fake cannot show that two
 * hundred concurrent inserts are serialised by an advisory lock and that the
 * sixteenth photo loses. It skips itself, cleanly and loudly, when there is no
 * DATABASE_URL or the migrations have not run. To run it:
 *
 *   pnpm exec tsx --env-file=.env.local --test src/data/media.db.test.ts
 *
 * Storage is the filesystem implementation under a throwaway directory, and
 * every row belongs to a `test_` user that is deleted afterwards.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { eq, sql } from "drizzle-orm";

import { db, schema } from "@/db/client";

import { countUploads as countLibraryUploads, MediaLimitReachedError, saveMedia, saveMediaCapped, saveMediaCappedAcross } from "./media";

const PREFIX = "test_media_";
const LIMIT = 15;

let storageRoot: string;
let previousDriver: string | undefined;
let previousRoot: string | undefined;

before(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), "media-cap-test-"));
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
        where table_schema = 'public' and table_name in ('users', 'avatars', 'media')
      `);
      return Number(rows[0]?.present ?? 0) === 3 ? null : "the media tables are not migrated yet";
    } catch (error) {
      return `database unreachable: ${error instanceof Error ? error.message : String(error)}`;
    }
  })();
  return checked;
}

async function withAccount(body: (userId: string, avatarId: string) => Promise<void>): Promise<void> {
  const userId = `${PREFIX}${randomUUID()}`;
  await db().insert(schema.users).values({ id: userId, email: `${userId}@example.invalid` });
  try {
    const [avatar] = await db()
      .insert(schema.avatars)
      .values({ userId, name: "Test", kind: "avatar" })
      .returning({ id: schema.avatars.id });
    await body(userId, avatar.id);
  } finally {
    await db().delete(schema.users).where(eq(schema.users.id, userId));
  }
}

/** A photo's worth of bytes; the contents do not matter to the SQL. */
const bytes = () => Buffer.from(`photo-${randomUUID()}`);

function upload(userId: string, avatarId: string) {
  return saveMediaCapped(
    userId,
    { kind: "upload", avatarId, data: bytes(), contentType: "image/jpeg", width: 100, height: 100 },
    LIMIT,
  );
}

async function countUploads(userId: string): Promise<number> {
  const { rows } = await db().execute<{ n: number }>(
    sql`select count(*)::int as n from media where user_id = ${userId} and kind = 'upload'`,
  );
  return Number(rows[0]?.n ?? 0);
}

test("two hundred concurrent uploads store exactly fifteen photos", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withAccount(async (userId, avatarId) => {
    /* This is the finding: checkUpload({ existing }) counted and saveMedia
       wrote, so every one of these read "fewer than fifteen" and every one of
       them wrote. */
    const results = await Promise.allSettled(Array.from({ length: 200 }, () => upload(userId, avatarId)));

    const stored = results.filter((r) => r.status === "fulfilled").length;
    const refused = results.filter((r) => r.status === "rejected");

    assert.equal(stored, LIMIT, "exactly the cap got through");
    assert.equal(await countUploads(userId), LIMIT, "and the table agrees");
    assert.ok(
      refused.every((r) => r.reason instanceof MediaLimitReachedError),
      "every refusal says why, rather than failing some other way",
    );
  });
});

test("the cap is per avatar, and other kinds are not counted against it", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withAccount(async (userId, avatarId) => {
    for (let i = 0; i < LIMIT; i++) await upload(userId, avatarId);
    await assert.rejects(() => upload(userId, avatarId), MediaLimitReachedError);

    // A generated image is not an uploaded photo and does not eat the allowance.
    const image = await saveMediaCapped(
      userId,
      { kind: "image", avatarId, data: bytes(), contentType: "image/jpeg" },
      LIMIT,
    );
    assert.ok(image.id);
    assert.equal(await countUploads(userId), LIMIT);

    // A second avatar starts with a clean allowance.
    const [second] = await db()
      .insert(schema.avatars)
      .values({ userId, name: "Second", kind: "avatar" })
      .returning({ id: schema.avatars.id });
    const other = await upload(userId, second.id);
    assert.ok(other.id);
  });
});

test("a refused upload leaves no bytes behind", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withAccount(async (userId, avatarId) => {
    for (let i = 0; i < LIMIT; i++) await upload(userId, avatarId);

    const { readdir } = await import("node:fs/promises");
    const dir = join(storageRoot, "users", userId, "upload");
    const before = (await readdir(dir)).length;
    await assert.rejects(() => upload(userId, avatarId), MediaLimitReachedError);
    assert.equal((await readdir(dir)).length, before, "the object for the refused row was deleted again");
  });
});

test("the library upload cap counts her uploads only: photos made here never use up her room", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  const CAP = 3;
  await withAccount(async (userId, avatarId) => {
    // Twice the cap in generated photos: none of them is an upload.
    for (let i = 0; i < CAP * 2; i++) await saveMedia(userId, { kind: "image", avatarId, data: bytes(), contentType: "image/jpeg", meta: { idea: "a scene" } });
    const libraryUpload = () =>
      saveMediaCappedAcross(userId, { kind: "image", avatarId, data: bytes(), contentType: "image/jpeg", meta: { source: "upload" } }, undefined, CAP);

    for (let i = 0; i < CAP; i++) assert.ok((await libraryUpload()).id);
    assert.equal(await countLibraryUploads(userId), CAP);
    await assert.rejects(libraryUpload, MediaLimitReachedError);
  });
});

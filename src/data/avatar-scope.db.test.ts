/* One avatar's things stay hers, against the real database.
 *
 * The bug: a carousel made under Maya picked Elle's photos, and Elle's
 * Library tabs counted Maya's photos and clips. The rows were always
 * separate (media.avatar_id); the queries were not. These pin the queries.
 *
 *   pnpm exec tsx --env-file=.env.local --test src/data/avatar-scope.db.test.ts
 *
 * Throwaway `test_` users only, deleted afterwards.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { eq, sql } from "drizzle-orm";

import { db, schema } from "@/db/client";

import { photoOptions } from "./carousels";
import { folderCounts, totalOf } from "./folders";
import { listMedia, ofAvatar, saveMedia } from "./media";

let storageRoot: string;
let previous: [string | undefined, string | undefined];

before(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), "avatar-scope-test-"));
  previous = [process.env.STORAGE_DRIVER, process.env.STORAGE_FS_ROOT];
  process.env.STORAGE_DRIVER = "fs";
  process.env.STORAGE_FS_ROOT = storageRoot;
});

after(async () => {
  const [driver, root] = previous;
  if (driver === undefined) delete process.env.STORAGE_DRIVER;
  else process.env.STORAGE_DRIVER = driver;
  if (root === undefined) delete process.env.STORAGE_FS_ROOT;
  else process.env.STORAGE_FS_ROOT = root;
  await rm(storageRoot, { recursive: true, force: true });
});

async function unavailable(): Promise<string | null> {
  if (!process.env.DATABASE_URL) return "no DATABASE_URL: run with --env-file=.env.local to exercise the real SQL";
  try {
    await db().execute(sql`select 1 from media limit 1`);
    return null;
  } catch (error) {
    return `database unreachable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

test("a row is usable for its own avatar, and a row from before avatars for any", () => {
  assert.equal(ofAvatar({ avatarId: "a" }, "a"), true);
  assert.equal(ofAvatar({ avatarId: "b" }, "a"), false);
  assert.equal(ofAvatar({ avatarId: null }, "a"), true);
});

test("carousel photos and Library counts are one avatar's, never the account's", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  const userId = `test_scope_${randomUUID()}`;
  await db().insert(schema.users).values({ id: userId, email: `${userId}@example.invalid` });
  try {
    const avatar = async (name: string) =>
      (await db().insert(schema.avatars).values({ userId, name, kind: "avatar" }).returning({ id: schema.avatars.id }))[0].id;
    const maya = await avatar("Maya");
    const elle = await avatar("Elle");
    const save = (kind: "image" | "clip", avatarId: string | null) =>
      saveMedia(userId, { kind, avatarId, data: Buffer.from(randomUUID()), contentType: kind === "clip" ? "video/mp4" : "image/png" });

    const mayaPhotos = [await save("image", maya), await save("image", maya), await save("image", maya)];
    await save("clip", maya);
    const ellePhotos = [await save("image", elle), await save("image", elle)];
    const legacy = await save("image", null);

    const forMaya = (await photoOptions(userId, maya)).map((photo) => photo.id).sort();
    assert.deepEqual(forMaya, [...mayaPhotos.map((row) => row.id), legacy.id].sort(), "Maya's photos and the pre-avatar one, never Elle's");
    const forElle = (await photoOptions(userId, elle)).map((photo) => photo.id).sort();
    assert.deepEqual(forElle, [...ellePhotos.map((row) => row.id), legacy.id].sort());

    const elleCounts = await folderCounts(userId, undefined, elle);
    assert.equal(totalOf(elleCounts, "image"), 3, "Elle's two and the pre-avatar one");
    assert.equal(totalOf(elleCounts, "clip"), 0, "Maya's clip is not Elle's");
    assert.equal(totalOf(await folderCounts(userId), "image"), 6, "the account still sees everything");

    // The agent's clip reuse reads the same way.
    assert.equal((await listMedia(userId, "clip", { avatarId: elle, orUnassigned: true })).length, 0);
  } finally {
    await db().delete(schema.users).where(eq(schema.users.id, userId));
  }
});

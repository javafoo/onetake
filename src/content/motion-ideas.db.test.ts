/* Suggested movements are looked at once, against real Postgres.
 *
 * An in-memory fake would prove nothing here: the whole feature is that the
 * answer is written onto the media row, in jsonb, and read back by a different
 * request in a different process. The model is injected, so nothing here calls
 * Gemini, and the count of injected calls is the assertion.
 *
 *   pnpm exec tsx --env-file=.env.local --test src/content/motion-ideas.db.test.ts
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

import type { InlineImage } from "../ai/gemini";
import type { generateText } from "../ai/text";
import { db, schema } from "../db/client";
import { getMedia, saveMedia } from "../data/media";

import { cachedMotionIdeas, motionIdeasFor } from "./motion-ideas";

const PREFIX = "test_motion_";

let storageRoot: string;
let previousDriver: string | undefined;
let previousRoot: string | undefined;

before(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), "motion-ideas-test-"));
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

const THREE = [
  "She lifts the mug, takes one slow sip, and sets it down again.",
  "She slowly tucks the hair on one side behind her ear.",
  "She glances down at the notebook, then lifts her eyes again.",
];

/** A model that answers with three suggestions and counts how often it is asked. */
function counting(motions: string[] = THREE) {
  const seen: { vision: boolean }[] = [];
  const model = (async (options: { images?: InlineImage[] }) => {
    seen.push({ vision: Boolean(options.images?.length) });
    return { motions } as never;
  }) as typeof generateText;
  return { model, seen };
}

function photo(userId: string, avatarId: string, meta: Record<string, unknown>) {
  return saveMedia(userId, {
    kind: "image",
    avatarId,
    data: Buffer.from(`photo-${randomUUID()}`),
    contentType: "image/jpeg",
    width: 1024,
    height: 1365,
    meta,
  });
}

test("a generated photo is read, not looked at, and the answer is remembered", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withAccount(async (userId, avatarId) => {
    const image = await photo(userId, avatarId, {
      idea: "At her kitchen counter in morning light, holding an iced coffee, laptop open beside her.",
      keep: true,
    });
    const { model, seen } = counting();

    const first = await motionIdeasFor(userId, image.id, { expressions: "warm, closed-mouth smile" }, { model });
    assert.equal(first.cached, false);
    assert.equal(first.sawPhoto, false, "the scene is on the row, so no thumbnail is needed");
    assert.deepEqual(first.ideas, THREE);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].vision, false, "a stored scene is a text call, not a vision one");

    // The row itself, not a process-local map: this is what a second request sees.
    const stored = await getMedia(userId, image.id);
    assert.deepEqual(cachedMotionIdeas(stored!), THREE);

    const second = await motionIdeasFor(userId, image.id, { expressions: "warm, closed-mouth smile" }, { model });
    assert.equal(second.cached, true);
    assert.deepEqual(second.ideas, THREE);
    assert.equal(seen.length, 1, "the second call asked no model anything");
  });
});

test("an upload with no scene on file is looked at once, and only once", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withAccount(async (userId, avatarId) => {
    const image = await photo(userId, avatarId, { source: "upload", originalName: "IMG_4471.HEIC" });
    const { model, seen } = counting();
    let thumbnails = 0;
    const thumbnail = async (): Promise<InlineImage> => {
      thumbnails += 1;
      return { mimeType: "image/jpeg", data: Buffer.from("thumb") };
    };

    const first = await motionIdeasFor(userId, image.id, null, { model, thumbnail });
    assert.equal(first.sawPhoto, true);
    assert.equal(seen[0].vision, true, "with no scene on the row the photograph itself is the prompt");
    assert.equal(thumbnails, 1);

    const second = await motionIdeasFor(userId, image.id, null, { model, thumbnail });
    assert.equal(second.cached, true);
    assert.equal(thumbnails, 1, "the photo is decoded once in its life, not once per tap");
    assert.equal(seen.length, 1);
  });
});

test("a model that breaks the rules or falls short is topped up, and nothing bad is cached", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withAccount(async (userId, avatarId) => {
    const image = await photo(userId, avatarId, { idea: "Sitting on the studio floor with her laptop." });
    const { model } = counting([
      "She types one line, then looks up.",
      "The camera pans across the room at a high angle.",
      "ok",
    ]);

    const { ideas } = await motionIdeasFor(userId, image.id, null, { model });
    assert.equal(ideas.length, 3, "the drawer promises three");
    assert.equal(ideas[0], "She types one line, then looks up.");
    assert.ok(
      ideas.every((line) => !/pans|high angle/i.test(line)),
      "a suggestion that breaks the rules is never offered",
    );

    const stored = await getMedia(userId, image.id);
    assert.deepEqual(cachedMotionIdeas(stored!), ideas);
  });
});

test("a photo belonging to somebody else is simply not there", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await withAccount(async (userId, avatarId) => {
    const image = await photo(userId, avatarId, { idea: "At the counter." });
    await withAccount(async (stranger) => {
      const { model, seen } = counting();
      await assert.rejects(() => motionIdeasFor(stranger, image.id, null, { model }), /not in your library/);
      assert.equal(seen.length, 0);
    });
  });
});

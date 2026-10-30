import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import type { CarouselDoc } from "./carousels";

/* The heart on a tile, against the real database. A set's heart lives in
   `drafts.spec` beside the spec, so the one thing that could lose it is
   `saveDoc` rewriting the spec after an edit or a redraw; a photo's lives in
   `media.meta`. Both are written only for the owner. */

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("favorites", { concurrency: false }, () => {
  let storageRoot = "";
  let data: typeof import("./avatars") & typeof import("./carousels") & typeof import("./drafts") & typeof import("./media") & typeof import("./users");

  const A = `test_${randomUUID().replace(/-/g, "")}`;
  const B = `test_${randomUUID().replace(/-/g, "")}`;
  let avatarA = "";
  let setA = "";
  let photoA = "";

  // Only the keys saveDoc's SQL touches; the spec's shape is the writer's business, not this test's.
  const doc = { caption: "A caption.", kit: "signal", photos: {} } as unknown as CarouselDoc;

  before(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "favorites-storage-"));
    process.env.STORAGE_DRIVER = "fs";
    process.env.STORAGE_FS_ROOT = storageRoot;

    const [avatars, carousels, drafts, media, users] = await Promise.all([
      import("./avatars"), import("./carousels"), import("./drafts"), import("./media"), import("./users"),
    ]);
    data = { ...avatars, ...carousels, ...drafts, ...media, ...users };

    await data.ensureUser(A, `${A}@example.test`);
    await data.ensureUser(B, `${B}@example.test`);
    avatarA = (await data.createAvatar(A, { name: "A" })).id;
    setA = (await data.createCarouselDraft(A, avatarA, { topic: "a", format: "carousel", skeleton: "list" })).id;
    photoA = (await data.saveMedia(A, { kind: "image", data: Buffer.from("x"), contentType: "image/png", avatarId: avatarA })).id;
  });

  after(async () => {
    await data.deleteAllMedia(A).catch(() => {});
    await data.deleteUser(A);
    await data.deleteUser(B);
    await rm(storageRoot, { recursive: true, force: true });
  });

  const favorite = async () => (await data.listCarousels(A)).find((set) => set.draft.id === setA)?.favorite;

  test("B cannot heart A's set, even knowing its id", async () => {
    assert.equal(await data.setSetFavorite(B, setA, true), false);
    assert.equal(await favorite(), false);
  });

  test("a set still being made can be hearted, and the spec landing keeps it", async () => {
    assert.equal(await data.setSetFavorite(A, setA, true), true);
    assert.equal(await favorite(), true);
    await data.saveDoc(A, setA, doc);
    assert.equal(await favorite(), true, "saveDoc must not drop the heart");
    const spec = (await data.getDraft(A, setA))?.spec as Record<string, unknown>;
    assert.equal(spec.kit, "signal", "the spec itself is still written");
  });

  test("taking the heart off stays off through a rewrite", async () => {
    assert.equal(await data.setSetFavorite(A, setA, false), true);
    await data.saveDoc(A, setA, doc);
    assert.equal(await favorite(), false);
    const spec = (await data.getDraft(A, setA))?.spec as Record<string, unknown>;
    assert.equal("favorite" in spec, false);
  });

  test("a photo's heart is in its meta, and only the owner can set it", async () => {
    assert.equal(await data.updateMediaMeta(B, photoA, { favorite: true }), null);
    assert.equal(((await data.getMedia(A, photoA))?.meta as { favorite?: unknown }).favorite, undefined);
    await data.updateMediaMeta(A, photoA, { favorite: true });
    assert.equal(((await data.getMedia(A, photoA))?.meta as { favorite?: unknown }).favorite, true);
  });

  test("the Favorites tab's queries return only hearted rows, and only hers", async () => {
    assert.deepEqual((await data.listMedia(A, "image", { favoritesOnly: true })).map((row) => row.id), [photoA]);
    assert.deepEqual(await data.listMedia(B, "image", { favoritesOnly: true }), []);
    assert.deepEqual(await data.listCarousels(A, { favoritesOnly: true }), [], "the set's heart was taken off above");
    await data.setSetFavorite(A, setA, true);
    assert.deepEqual((await data.listCarousels(A, { favoritesOnly: true })).map((set) => set.draft.id), [setA]);
    assert.deepEqual(await data.listCarousels(B, { favoritesOnly: true }), []);
  });
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

/* Folders against the real database, with throwaway users.
 *
 * Two things are checked. Tenancy: a folder is reached, renamed, deleted and
 * filed into only by the account that owns it, and a move never touches
 * another account's rows. Behaviour: deleting a folder leaves its items in
 * the library, and deleting a reel puts its draft back to written rather than
 * leaving a planned post with nothing to download. */

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("folders", { concurrency: false }, () => {
  let storageRoot = "";
  let data: typeof import("./drafts") & typeof import("./folders") & typeof import("./media") & typeof import("./users") & typeof import("./avatars");

  const A = `test_${randomUUID().replace(/-/g, "")}`;
  const B = `test_${randomUUID().replace(/-/g, "")}`;
  const bytes = Buffer.from("not yours");

  let avatarB = "";
  let folderA = "";
  let folderB = "";
  let mediaB = "";

  before(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "folders-storage-"));
    process.env.STORAGE_DRIVER = "fs";
    process.env.STORAGE_FS_ROOT = storageRoot;

    const [avatars, drafts, folders, media, users] = await Promise.all([
      import("./avatars"), import("./drafts"), import("./folders"), import("./media"), import("./users"),
    ]);
    data = { ...avatars, ...drafts, ...folders, ...media, ...users };

    await data.ensureUser(A, `${A}@example.test`);
    await data.ensureUser(B, `${B}@example.test`);
    avatarB = (await data.createAvatar(B, { name: "B" })).id;
    folderA = (await data.createFolder(A, "A's shoot")).id;
    folderB = (await data.createFolder(B, "B's shoot")).id;
    await data.saveMedia(A, { kind: "image", data: bytes, contentType: "image/png" });
    mediaB = (await data.saveMedia(B, { kind: "image", data: bytes, contentType: "image/png", folderId: folderB })).id;
  });

  after(async () => {
    await data.deleteAllMedia(A).catch(() => {});
    await data.deleteAllMedia(B).catch(() => {});
    await data.deleteUser(A);
    await data.deleteUser(B);
    await rm(storageRoot, { recursive: true, force: true });
  });

  test("A cannot see, rename or delete B's folder", async () => {
    assert.equal(await data.getFolder(A, folderB), null);
    assert.deepEqual((await data.listFolders(A)).map((row) => row.id), [folderA]);
    assert.equal(await data.renameFolder(A, folderB, "stolen"), null);
    assert.equal(await data.deleteFolder(A, folderB), false);
    assert.equal((await data.getFolder(B, folderB))?.name, "B's shoot");
  });

  test("A cannot file anything into B's folder, and cannot move B's media", async () => {
    await assert.rejects(() => data.requireOwnFolder(A, folderB), /does not exist/);
    assert.equal(await data.moveMedia(A, [mediaB], folderA), 0);
    assert.equal((await data.getMedia(B, mediaB))?.folderId, folderB);
  });

  test("a folder's counts are its owner's, per kind, and skip rejected takes", async () => {
    const rejected = await data.saveMedia(B, { kind: "image", data: bytes, contentType: "image/png", folderId: folderB, meta: { keep: false } });
    const clip = await data.saveMedia(B, { kind: "clip", data: bytes, contentType: "video/mp4", folderId: folderB });
    const counts = await data.folderCounts(B);
    assert.deepEqual(counts[folderB], { image: 1, clip: 1 });
    assert.equal(data.totalOf(counts, "image"), 1);
    assert.deepEqual((await data.listMedia(B, "image", { folder: folderB, keptOnly: true })).map((row) => row.id), [mediaB]);
    await data.deleteMedia(B, rejected.id);
    await data.deleteMedia(B, clip.id);
  });

  test("listing by folder: an id, 'not in a folder', or everything", async () => {
    const loose = await data.saveMedia(B, { kind: "image", data: bytes, contentType: "image/png" });
    assert.deepEqual((await data.listMedia(B, "image", { folder: folderB })).map((row) => row.id), [mediaB]);
    assert.deepEqual((await data.listMedia(B, "image", { folder: null })).map((row) => row.id), [loose.id]);
    assert.equal((await data.listMedia(B, "image")).length, 2);
    await data.deleteMedia(B, loose.id);
  });

  test("deleting a folder leaves its items in the library, unfiled", async () => {
    const spare = (await data.createFolder(B, "Spare")).id;
    assert.equal(await data.moveMedia(B, [mediaB], spare), 1);
    assert.equal((await data.getMedia(B, mediaB))?.folderId, spare);
    assert.equal(await data.deleteFolder(B, spare), true);
    const survivor = await data.getMedia(B, mediaB);
    assert.ok(survivor, "the photo is still there");
    assert.equal(survivor.folderId, null);
    // Back where it started, for the tests that follow.
    await data.moveMedia(B, [mediaB], folderB);
  });

  test("deleting a reel puts its draft back to written", async () => {
    const [draft] = await data.addDrafts(B, avatarB, [{ hook: "b", angle: "b", caption: "b", cta: "b" }]);
    const reel = await data.saveMedia(B, { kind: "reel", data: bytes, contentType: "video/mp4", avatarId: avatarB });
    await data.updateDraft(B, draft.id, { outputMediaId: reel.id, status: "assembled" });

    assert.equal(await data.deleteMedia(B, reel.id), true);
    const after = await data.getDraft(B, draft.id);
    assert.equal(after?.status, "draft");
    assert.equal(after?.outputMediaId, null);
    assert.equal(after?.hook, "b", "the hook is kept");
    await data.deleteDraft(B, draft.id);
  });

  test("the folder cap is enforced in the insert, with a sentence", async () => {
    const made: string[] = [];
    for (let i = (await data.listFolders(A)).length; i < data.MAX_FOLDERS; i += 1) made.push((await data.createFolder(A, `f${i}`)).id);
    await assert.rejects(() => data.createFolder(A, "one too many"), new RegExp(`${data.MAX_FOLDERS} folders`));
    for (const id of made) await data.deleteFolder(A, id);
  });
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import { copiedMeta, copyRoot, planCopies } from "@/lib/uploads";

/* Copying an upload to another avatar, against the real database and the
   filesystem store. What matters is what SQL and storage do: the copy is a
   row of its own on the other avatar with its own object, deleting one leaves
   the other readable, the "already there" lookup finds a copy by its root, and
   another account's rows are never read. Every row belongs to `test_` users
   that are deleted afterwards. */

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("copying uploads to another avatar", { concurrency: false }, () => {
  let storageRoot = "";
  let data: typeof import("./avatars") & typeof import("./media") & typeof import("./users");

  const A = `test_${randomUUID().replace(/-/g, "")}`;
  const B = `test_${randomUUID().replace(/-/g, "")}`;
  let maya = "";
  let mia = "";
  let place = "";

  before(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "uploads-copy-storage-"));
    process.env.STORAGE_DRIVER = "fs";
    process.env.STORAGE_FS_ROOT = storageRoot;
    const [avatars, media, users] = await Promise.all([import("./avatars"), import("./media"), import("./users")]);
    data = { ...avatars, ...media, ...users };

    await data.ensureUser(A, `${A}@example.test`);
    await data.ensureUser(B, `${B}@example.test`);
    maya = (await data.createAvatar(A, { name: "Maya" })).id;
    mia = (await data.createAvatar(A, { name: "Mia" })).id;
    place = (
      await data.saveMedia(A, {
        kind: "image",
        data: Buffer.from("a desk by a window"),
        contentType: "image/jpeg",
        avatarId: maya,
        meta: { source: "upload", subject: "scene", favorite: true },
      })
    ).id;
    await data.saveMedia(A, { kind: "image", data: Buffer.from("made"), contentType: "image/jpeg", avatarId: maya, meta: { idea: "a café" } });
  });

  after(async () => {
    await data.deleteAllMedia(A).catch(() => {});
    await data.deleteUser(A);
    await data.deleteUser(B);
    await rm(storageRoot, { recursive: true, force: true });
  });

  test("the Uploads list is her uploads only, on every avatar", async () => {
    assert.deepEqual((await data.listUploads(A)).map((row) => row.id), [place]);
    assert.deepEqual(await data.listUploads(B), []);
    assert.deepEqual(await data.getManyMedia(B, [place]), [], "another account cannot read it by id");
  });

  test("a copy is its own row and object on the other avatar, and a second press finds it", async () => {
    const [source] = await data.getManyMedia(A, [place]);
    const copy = await data.copyMediaToAvatar(A, source, mia, copiedMeta(source, new Date()));
    assert.equal(copy.avatarId, mia);
    assert.equal(copy.kind, "image");
    assert.notEqual(copy.pathname, source.pathname);
    const meta = copy.meta as Record<string, unknown>;
    assert.equal(meta.subject, "scene");
    assert.equal(meta.copiedFrom, place);
    assert.equal("favorite" in meta, false);

    const onMia = await data.copyRootsOnAvatar(A, mia, [copyRoot(source)]);
    assert.deepEqual([...onMia], [place]);
    assert.equal(planCopies([source], mia, onMia).copy.length, 0);
    assert.deepEqual([...(await data.copyRootsOnAvatar(B, mia, [place]))], [], "another account sees nothing");

    // Deleting the original leaves the copy whole.
    assert.equal(await data.deleteMedia(A, place), true);
    assert.equal((await data.readMedia(A, copy.id)).toString(), "a desk by a window");
  });

  test("copying another account's row is refused", async () => {
    const [copy] = await data.listUploads(A);
    await assert.rejects(data.copyMediaToAvatar(B, copy, mia, {}));
  });
});

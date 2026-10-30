import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

/* The real database, with throwaway users. user_id is the only tenant boundary
   there is, so these check that it actually holds: every repository function is
   asked for another user's row and must answer as if it did not exist. */

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("tenancy", { concurrency: false }, () => {
  let storageRoot = "";
  let data: typeof import("./avatars") &
    typeof import("./brand") &
    typeof import("./drafts") &
    typeof import("./media") &
    typeof import("./users");

  const A = `test_${randomUUID().replace(/-/g, "")}`;
  const B = `test_${randomUUID().replace(/-/g, "")}`;
  const bytes = Buffer.from("not yours");

  let avatarA = "";
  let avatarB = "";
  let mediaA = "";
  let mediaB = "";
  let draftA = "";
  let draftB = "";
  let referenceB = "";

  before(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "tenancy-storage-"));
    process.env.STORAGE_DRIVER = "fs";
    process.env.STORAGE_FS_ROOT = storageRoot;

    const [avatars, brand, drafts, media, users] = await Promise.all([
      import("./avatars"), import("./brand"), import("./drafts"), import("./media"), import("./users"),
    ]);
    data = { ...avatars, ...brand, ...drafts, ...media, ...users };

    await data.ensureUser(A, `${A}@example.test`);
    await data.ensureUser(B, `${B}@example.test`);

    avatarA = (await data.createAvatar(A, { name: "A" })).id;
    avatarB = (await data.createAvatar(B, { name: "B", lock: { subject: "b", hair: "", skinMakeup: "", accessories: "", expressions: "", wardrobe: [], scenes: [], bannedWords: [] } })).id;

    mediaA = (await data.saveMedia(A, { kind: "image", data: bytes, contentType: "image/png", avatarId: avatarA })).id;
    mediaB = (await data.saveMedia(B, { kind: "image", data: bytes, contentType: "image/png", avatarId: avatarB })).id;

    draftA = (await data.addDrafts(A, avatarA, [{ hook: "a", angle: "a", caption: "a", cta: "a" }]))[0].id;
    draftB = (await data.addDrafts(B, avatarB, [{ hook: "b", angle: "b", caption: "b", cta: "b" }]))[0].id;

    referenceB = (await data.addReference(B, avatarB, { mediaId: mediaB, role: "front", source: "generated" })).id;
    await data.saveProfile(B, avatarB, { ...data.EMPTY_PROFILE, niche: "b's niche", keyword: "BEE" });
  });

  after(async () => {
    // Everything customer-owned cascades from users, and the blobs go with it.
    await data.deleteAllMedia(A).catch(() => {});
    await data.deleteAllMedia(B).catch(() => {});
    await data.deleteUser(A);
    await data.deleteUser(B);
    await rm(storageRoot, { recursive: true, force: true });
  });

  test("A cannot read B's avatar", async () => {
    assert.equal(await data.getAvatar(A, avatarB), null);
    assert.deepEqual((await data.listAvatars(A)).map((row) => row.id), [avatarA]);
    assert.equal((await data.primaryAvatar(A))?.id, avatarA);
  });

  test("A cannot update or delete B's avatar", async () => {
    assert.equal(await data.updateAvatar(A, avatarB, { name: "stolen" }), null);
    assert.equal(await data.deleteAvatar(A, avatarB), false);
    assert.equal((await data.getAvatar(B, avatarB))?.name, "B");
  });

  test("A cannot read B's media", async () => {
    assert.equal(await data.getMedia(A, mediaB), null);
    assert.deepEqual((await data.listMedia(A, "image")).map((row) => row.id), [mediaA]);
    await assert.rejects(() => data.readMedia(A, mediaB), /Media not found/);
    await assert.rejects(() => data.withLocalFile(A, mediaB, async () => "read"), /Media not found/);
  });

  test("A cannot update or delete B's media", async () => {
    assert.equal(await data.updateMediaMeta(A, mediaB, { stolen: true }), null);
    assert.equal(await data.deleteMedia(A, mediaB), false);
    const survivor = await data.getMedia(B, mediaB);
    assert.equal(survivor?.meta && (survivor.meta as { stolen?: boolean }).stolen, undefined);
  });

  test("A cannot attach B's media to A's own avatar", async () => {
    await assert.rejects(() => data.addReference(A, avatarA, { mediaId: mediaB, role: "front", source: "original" }), /Media not found/);
  });

  test("A cannot read, approve or delete B's references", async () => {
    assert.deepEqual(await data.listReferences(A, avatarB), []);
    assert.equal(await data.approveReference(A, referenceB), null);
    assert.equal(await data.deleteReference(A, referenceB), false);
    assert.equal((await data.listReferences(B, avatarB))[0].approved, false);
    assert.deepEqual(await data.referenceMediaIds(A, avatarB), []);
  });

  test("A cannot read B's brand profile or brief", async () => {
    assert.equal(await data.getBrand(A, avatarB), null);
    assert.equal((await data.getProfile(A, avatarB)).keyword, "");
    assert.equal(await data.getBrief(A, avatarB), null);
  });

  test("A cannot overwrite B's brand profile, even knowing the avatar id", async () => {
    await assert.rejects(() => data.saveProfile(A, avatarB, { ...data.EMPTY_PROFILE, keyword: "STOLEN" }), /Avatar not found/);
    await assert.rejects(
      () => data.saveBrief(A, avatarB, { builtAt: "", sources: [], oneLiner: { text: "", source: "" }, audience: [], problem: [], offer: [], story: { before: { text: "", source: "" }, turn: { text: "", source: "" }, after: { text: "", source: "" } }, pointOfView: [], voiceIs: [], voiceIsNot: [], proof: [], positioningLines: [], conflicts: [] }),
      /Avatar not found/,
    );
    assert.equal((await data.getProfile(B, avatarB)).keyword, "BEE");
  });

  test("A cannot read, update or delete B's draft", async () => {
    assert.equal(await data.getDraft(A, draftB), null);
    assert.deepEqual((await data.listDrafts(A)).map((row) => row.id), [draftA]);
    assert.equal(await data.updateDraft(A, draftB, { hook: "stolen" }), null);
    assert.equal(await data.deleteDraft(A, draftB), false);
    assert.equal(await data.duplicateDraft(A, draftB), null);
    assert.equal((await data.getDraft(B, draftB))?.hook, "b");
  });

  test("A cannot add a draft to B's avatar", async () => {
    await assert.rejects(() => data.addDrafts(A, avatarB, [{ hook: "x", angle: "x", caption: "x", cta: "x" }]), /Avatar not found/);
  });

  test("an id that is not a uuid is a miss, not a database error", async () => {
    assert.equal(await data.getMedia(A, "../../etc/passwd"), null);
    assert.equal(await data.getAvatar(A, "not-an-id"), null);
    assert.equal(await data.getDraft(A, "'; drop table drafts; --"), null);
  });

  /* The media route's whole authorisation is getMedia(userId, id): this is that
     decision, made the same way the handler makes it. */
  test("the media route refuses a non-owner", async () => {
    const asOwner = await data.getMedia(B, mediaB);
    assert.equal(asOwner?.id, mediaB);
    assert.equal(await data.getMedia(A, mediaB), null, "a non-owner must get no row, which the route answers as 404");
  });

  test("each user's bytes live under their own prefix", async () => {
    const rowA = await data.getMedia(A, mediaA);
    const rowB = await data.getMedia(B, mediaB);
    assert.ok(rowA?.pathname.startsWith(`users/${A}/`));
    assert.ok(rowB?.pathname.startsWith(`users/${B}/`));
  });
});

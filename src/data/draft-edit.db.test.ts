import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

/* `editDraftAction`'s whole authorisation is `applyDraftEdit(user.id, id, …)`,
   the way the media route's is `getMedia(userId, id)`. This is that decision,
   made against the real database with throwaway users, the same way the action
   makes it — plus the two things it does on the way out: it refuses an edit
   that breaks the writer's rules, and it takes a finished reel off the calendar
   because that reel now has the old hook printed on it. */

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("applyDraftEdit", { concurrency: false }, () => {
  let storageRoot = "";
  let data: typeof import("./avatars") &
    typeof import("./brand") &
    typeof import("./drafts") &
    typeof import("./media") &
    typeof import("./users");

  const A = `test_${randomUUID().replace(/-/g, "")}`;
  const B = `test_${randomUUID().replace(/-/g, "")}`;

  let draftA = "";
  let draftB = "";
  let plannedB = "";

  const edit = {
    hook: "I stopped posting every day and my reach went up.",
    caption: "Here is what happened in the four weeks after I stopped.",
    cta: "Comment BEE and I will send you the checklist.",
  };

  before(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "draft-edit-storage-"));
    process.env.STORAGE_DRIVER = "fs";
    process.env.STORAGE_FS_ROOT = storageRoot;

    const [avatars, brand, drafts, media, users] = await Promise.all([
      import("./avatars"), import("./brand"), import("./drafts"), import("./media"), import("./users"),
    ]);
    data = { ...avatars, ...brand, ...drafts, ...media, ...users };

    await data.ensureUser(A, `${A}@example.test`);
    await data.ensureUser(B, `${B}@example.test`);

    const avatarA = (await data.createAvatar(A, { name: "A" })).id;
    const avatarB = (await data.createAvatar(B, { name: "B" })).id;
    await data.saveProfile(A, avatarA, { ...data.EMPTY_PROFILE, niche: "a", keyword: "ANT" });
    await data.saveProfile(B, avatarB, { ...data.EMPTY_PROFILE, niche: "b", keyword: "BEE" });

    draftA = (await data.addDrafts(A, avatarA, [{ hook: "a", angle: "a", caption: "a", cta: "a" }]))[0].id;
    draftB = (await data.addDrafts(B, avatarB, [{ hook: "b", angle: "b", caption: "b", cta: "comment BEE" }]))[0].id;

    // B's other draft has a finished reel.
    plannedB = (await data.addDrafts(B, avatarB, [{ hook: "planned", angle: "b", caption: "b", cta: "comment BEE" }]))[0].id;
    const reel = await data.saveMedia(B, {
      kind: "reel", data: Buffer.from("not a real mp4"), contentType: "video/mp4", avatarId: avatarB,
    });
    await data.updateDraft(B, plannedB, { outputMediaId: reel.id, status: "assembled" });
  });

  after(async () => {
    await data.deleteAllMedia(A).catch(() => {});
    await data.deleteAllMedia(B).catch(() => {});
    await data.deleteUser(A);
    await data.deleteUser(B);
    await rm(storageRoot, { recursive: true, force: true });
  });

  test("A cannot edit B's draft, even knowing its id", async () => {
    assert.equal(await data.applyDraftEdit(A, draftB, edit), null, "a non-owner must get no row, which the action answers as 'Draft not found'");
    assert.equal((await data.getDraft(B, draftB))?.hook, "b");
  });

  test("an id that is not a uuid is a miss, not a database error", async () => {
    assert.equal(await data.applyDraftEdit(A, "'; drop table drafts; --", edit), null);
    assert.equal(await data.applyDraftEdit(A, "", edit), null);
  });

  test("the owner's own edit is saved", async () => {
    const saved = await data.applyDraftEdit(B, draftB, edit);
    assert.equal(saved?.draft.hook, edit.hook);
    assert.equal(saved?.draft.caption, edit.caption);
    assert.equal(saved?.staleReel, false, "this draft has no reel to go stale");
    assert.equal((await data.getDraft(B, draftB))?.hook, edit.hook);
  });

  test("the keyword checked is the draft's own avatar's, not the caller's", async () => {
    // A's keyword is ANT; B's is BEE. B's CTA must name BEE.
    await assert.rejects(
      () => data.applyDraftEdit(B, draftB, { ...edit, cta: "Comment ANT for the list." }),
      /"BEE"/,
    );
    assert.equal((await data.getDraft(B, draftB))?.cta, edit.cta, "a refused edit must change nothing");
  });

  test("editing a draft that already has a reel marks it stale", async () => {
    const saved = await data.applyDraftEdit(B, plannedB, { ...edit, hook: "A different hook entirely." });
    assert.equal(saved?.staleReel, true);
    const row = await data.getDraft(B, plannedB);
    assert.equal(row?.status, "draft", "the card offers Re-assemble off this");
    assert.ok(row?.outputMediaId, "the old reel stays downloadable until a new one replaces it");
  });

  test("A's own draft is untouched by any of it", async () => {
    assert.equal((await data.getDraft(A, draftA))?.hook, "a");
  });
});

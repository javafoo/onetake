import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

/* Saved hooks against the real database, with throwaway users.
 *
 * Tenancy: a hook is listed, edited, archived, deleted and marked only by the
 * account that owns it, and nobody can file a hook on another account's
 * avatar. Behaviour: the database refuses the same words twice for one
 * avatar, the filters split the list the way the page says, and a mark keeps
 * the first time it was set. */

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("hooks", { concurrency: false }, () => {
  let data: typeof import("./hooks") & typeof import("./users") & typeof import("./avatars") & typeof import("./drafts") & typeof import("./media");
  let storageRoot = "";

  const A = `test_${randomUUID().replace(/-/g, "")}`;
  const B = `test_${randomUUID().replace(/-/g, "")}`;
  let avatarA = "";
  let avatarB = "";

  before(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "hooks-storage-"));
    process.env.STORAGE_DRIVER = "fs";
    process.env.STORAGE_FS_ROOT = storageRoot;
    const [avatars, drafts, hooks, media, users] = await Promise.all([import("./avatars"), import("./drafts"), import("./hooks"), import("./media"), import("./users")]);
    data = { ...avatars, ...drafts, ...hooks, ...media, ...users };
    await data.ensureUser(A, `${A}@example.test`);
    await data.ensureUser(B, `${B}@example.test`);
    avatarA = (await data.createAvatar(A, { name: "A" })).id;
    avatarB = (await data.createAvatar(B, { name: "B" })).id;
  });

  after(async () => {
    await data.deleteAllMedia(A).catch(() => {});
    await data.deleteUser(A);
    await data.deleteUser(B);
    await rm(storageRoot, { recursive: true, force: true });
  });

  test("a batch is saved once each, and a repeat of saved words is skipped", async () => {
    const first = await data.addHooks(A, avatarA, ["I stopped filming myself", "  i STOPPED filming myself ", "Nobody reads captions"]);
    assert.equal(first.length, 2);
    const again = await data.addHooks(A, avatarA, ["Nobody reads captions", "A third one"]);
    assert.deepEqual(again.map((row) => row.text), ["A third one"]);
  });

  test("one hook saved twice is refused with a sentence", async () => {
    await assert.rejects(() => data.addHook(A, avatarA, " nobody reads CAPTIONS "), /already saved/);
  });

  test("the database itself refuses a duplicate that skips the checks", async () => {
    const { db, schema } = await import("@/db/client");
    await assert.rejects(() => db().insert(schema.hooks).values({ userId: A, avatarId: avatarA, text: "I STOPPED FILMING MYSELF" }));
  });

  test("nobody can file a hook on another account's avatar", async () => {
    await assert.rejects(() => data.addHook(A, avatarB, "Not mine"), /setup/);
    await assert.rejects(() => data.addHooks(A, avatarB, ["Not mine"]), /setup/);
    assert.deepEqual(await data.listHooks(A, avatarB), []);
  });

  test("B's hook cannot be read, edited, archived, deleted or marked by A", async () => {
    const hookB = await data.addHook(B, avatarB, "B's own words");
    assert.equal(await data.getHook(A, hookB.id), null);
    assert.equal(await data.updateHookText(A, hookB.id, "stolen"), null);
    assert.equal(await data.setHooksArchived(A, [hookB.id], true), 0);
    assert.equal(await data.markHookUsed(A, hookB.id, "reel"), null);
    assert.equal(await data.deleteHooks(A, [hookB.id]), 0);
    const still = await data.getHook(B, hookB.id);
    assert.equal(still?.text, "B's own words");
    assert.equal(still?.archivedAt, null);
    assert.equal(still?.usedReelAt, null);
  });

  test("filters split the list, and a search narrows it", async () => {
    const rows = await data.listHooks(A, avatarA);
    const [third, captions] = [rows.find((row) => row.text === "A third one")!, rows.find((row) => row.text === "Nobody reads captions")!];
    await data.markHookUsed(A, third.id, "copied");
    await data.setHooksArchived(A, [captions.id], true);

    const texts = async (filter: "unused" | "used" | "archived" | "all", query?: string) =>
      (await data.listHooks(A, avatarA, { filter, query })).map((row) => row.text).sort();
    assert.deepEqual(await texts("unused"), ["I stopped filming myself"]);
    assert.deepEqual(await texts("used"), ["A third one"]);
    assert.deepEqual(await texts("archived"), ["Nobody reads captions"]);
    assert.equal((await texts("all")).length, 3);
    assert.deepEqual(await texts("all", "FILMING"), ["I stopped filming myself"]);
    assert.deepEqual(await texts("all", "%"), []);
    assert.deepEqual(await data.countHooks(A, avatarA), { all: 3, archived: 1, used: 1, unused: 1 });

    assert.equal(await data.setHooksArchived(A, [captions.id], false), 1);
    assert.deepEqual(await texts("unused"), ["I stopped filming myself", "Nobody reads captions"]);
  });

  test("a mark keeps the first time it was set", async () => {
    const [row] = await data.listHooks(A, avatarA, { query: "filming" });
    const first = await data.markHookUsed(A, row.id, "reel");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await data.markHookUsed(A, row.id, "reel");
    assert.ok(first?.usedReelAt);
    assert.equal(second?.usedReelAt?.getTime(), first.usedReelAt.getTime());
  });

  test("an edit that would repeat another hook is refused; a real edit saves", async () => {
    const rows = await data.listHooks(A, avatarA);
    const target = rows.find((row) => row.text === "A third one")!;
    await assert.rejects(() => data.updateHookText(A, target.id, "nobody reads captions"), /already saved/);
    const saved = await data.updateHookText(A, target.id, "  A   better third one ");
    assert.equal(saved?.text, "A better third one");
  });

  test("delete takes only the ids given, and only A's", async () => {
    const before = await data.listHooks(A, avatarA);
    assert.equal(await data.deleteHooks(A, [before[0].id, "not-a-uuid"]), 1);
    assert.equal((await data.listHooks(A, avatarA)).length, before.length - 1);
  });

  test("deleting a reel puts its hook back on Hooks, once", async () => {
    const reel = await data.saveMedia(A, { kind: "reel", data: Buffer.from("reel"), contentType: "video/mp4", avatarId: avatarA });
    const [draft] = await data.addDrafts(A, avatarA, [{ hook: "A reel I regret", angle: "", caption: "c", cta: "c" }]);
    await data.updateDraft(A, draft.id, { outputMediaId: reel.id, status: "assembled" });
    assert.equal(await data.deleteMedia(A, reel.id), true);
    const saved = (await data.listHooks(A, avatarA, { query: "regret" })).map((row) => row.text);
    assert.deepEqual(saved, ["A reel I regret"]);
  });
});

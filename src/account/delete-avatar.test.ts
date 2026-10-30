import assert from "node:assert/strict";
import { test } from "node:test";

import { checkAvatarDeletion, eraseAvatar } from "./delete-avatar";

/* Deleting one avatar: the rules, and the order of the steps. */

test("the only avatar cannot be deleted on its own; the name has to be typed", () => {
  assert.equal(checkAvatarDeletion({ name: "Maya", typed: "Maya", avatars: 1 }).ok, false);
  assert.match((checkAvatarDeletion({ name: "Maya", typed: "Maya", avatars: 1 }) as { message: string }).message, /Delete account/);
  assert.deepEqual(checkAvatarDeletion({ name: "Maya", typed: "May", avatars: 2 }), { ok: false, message: "Type Maya exactly to confirm." });
  // Case and stray spaces are not the point of the check; the name is.
  assert.deepEqual(checkAvatarDeletion({ name: "Maya Reed", typed: "  maya   reed ", avatars: 2 }), { ok: true });
});

test("every stored object goes before the row, which is the only record of them", async () => {
  const steps: string[] = [];
  const result = await eraseAvatar("user_1", "avatar_1", {
    pathnames: async () => ["users/user_1/image/a.png", "users/user_1/clip/b.mp4", "users/user_1/slide/c.png"],
    deleteObject: async (pathname) => {
      steps.push(`object ${pathname}`);
    },
    deleteRow: async () => {
      steps.push("row");
      return true;
    },
  });
  assert.deepEqual(result, { existed: true, objects: 3 });
  assert.equal(steps.at(-1), "row");
  assert.equal(steps.filter((step) => step.startsWith("object")).length, 3);
});

test("a row is never deleted after a failed object delete: the next attempt still knows what to remove", async () => {
  let rowDeleted = false;
  await assert.rejects(() =>
    eraseAvatar("user_1", "avatar_1", {
      pathnames: async () => ["users/user_1/image/a.png"],
      deleteObject: async () => {
        throw new Error("storage is down");
      },
      deleteRow: async () => {
        rowDeleted = true;
        return true;
      },
    }),
  );
  assert.equal(rowDeleted, false);
});

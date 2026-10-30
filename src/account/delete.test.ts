import assert from "node:assert/strict";
import test from "node:test";

import { eraseAccount, type DeletionDeps } from "./delete";

function fakes(media: number | null) {
  const calls: string[] = [];
  const deps: DeletionDeps = {
    snapshot: async () => (media === null ? null : { media }),
    deleteObjects: async () => {
      calls.push("objects");
    },
    deleteRows: async () => {
      calls.push("rows");
      return media !== null;
    },
  };
  return { deps, calls };
}

test("the stored objects go before the rows that are the only record of them", async () => {
  const { deps, calls } = fakes(3);
  const result = await eraseAccount("user_1", deps);
  assert.deepEqual(calls, ["objects", "rows"]);
  assert.deepEqual(result, { existed: true, media: 3 });
});

test("a repeat delivery for an account already gone touches nothing", async () => {
  const { deps, calls } = fakes(null);
  const result = await eraseAccount("user_1", deps);
  assert.deepEqual(calls, []);
  assert.deepEqual(result, { existed: false, media: 0 });
});

test("an empty user id is refused", async () => {
  const { deps } = fakes(0);
  await assert.rejects(eraseAccount("", deps));
});

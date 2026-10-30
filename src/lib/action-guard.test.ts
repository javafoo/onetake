import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { dedupeKey, requestIdFrom } from "./action-guard";

test("a retried submission lands on the same slot", () => {
  const id = randomUUID();
  assert.equal(requestIdFrom(id), id);
  assert.equal(dedupeKey("user_a", requestIdFrom(id)), dedupeKey("user_a", requestIdFrom(id)));
});

test("two accounts sending the same request id never share a slot", () => {
  /* This is the bug: the map used to be keyed on the client's id alone, so
     user B could send user A's id and be handed A's result — or park an id and
     collect whatever A ran under it. */
  const id = randomUUID();
  assert.notEqual(dedupeKey("user_a", id), dedupeKey("user_b", id));
});

test("anything that is not a uuid gets its own fresh slot", () => {
  for (const supplied of ["", "   ", "not-a-uuid", "../../etc", null, undefined, 42, { toString: () => randomUUID() }]) {
    const first = requestIdFrom(supplied);
    const second = requestIdFrom(supplied);
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.notEqual(first, second, "an unusable id cannot be used to collide on purpose");
  }
});

test("surrounding whitespace does not make two ids different", () => {
  const id = randomUUID();
  assert.equal(requestIdFrom(`  ${id}  `), id);
});

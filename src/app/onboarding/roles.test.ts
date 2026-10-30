import assert from "node:assert/strict";
import { test } from "node:test";

import { assignmentsFromForm, assignRoles, cleanProposals, ROLE_ORDER, type RoleProposal } from "./roles";

const ids = ["a", "b", "c", "d", "e", "f"];

const proposal = (mediaId: string, role: RoleProposal["role"], confidence = 0.8, note = ""): RoleProposal => ({
  mediaId,
  role,
  confidence,
  note,
});

test("one clear proposal per role fills the set in casting order", () => {
  const set = assignRoles(
    [
      proposal("c", "profile"),
      proposal("a", "front"),
      proposal("e", "expression"),
      proposal("b", "three_quarter"),
      proposal("d", "full_body"),
    ],
    ids,
  );
  assert.deepEqual(
    set.map((item) => [item.role, item.mediaId, item.position]),
    [
      ["front", "a", 0],
      ["three_quarter", "b", 1],
      ["profile", "c", 2],
      ["full_body", "d", 3],
      ["expression", "e", 4],
    ],
  );
});

test("the best guess wins when two photos claim one role", () => {
  const set = assignRoles([proposal("a", "front", 0.4), proposal("b", "front", 0.9)], ids);
  assert.deepEqual(set, [{ mediaId: "b", role: "front", position: 0 }]);
});

test("a tie is broken by upload order, so the same photos always give the same set", () => {
  const first = assignRoles([proposal("d", "front", 0.7), proposal("b", "front", 0.7)], ids);
  const second = assignRoles([proposal("b", "front", 0.7), proposal("d", "front", 0.7)], ids);
  assert.deepEqual(first, second);
  assert.equal(first[0].mediaId, "b");
});

test("one photo cannot play two parts", () => {
  const set = assignRoles([proposal("a", "front", 0.9), proposal("a", "profile", 0.9)], ids);
  assert.deepEqual(set, [{ mediaId: "a", role: "front", position: 0 }]);
});

test("a role nobody covers is left empty, and positions stay contiguous", () => {
  const set = assignRoles([proposal("a", "front"), proposal("b", "full_body")], ids);
  assert.deepEqual(set, [
    { mediaId: "a", role: "front", position: 0 },
    { mediaId: "b", role: "full_body", position: 1 },
  ]);
});

test("front is always filled: nothing downstream runs without a reference", () => {
  const set = assignRoles([proposal("a", "profile", 0.9), proposal("b", "expression", 0.6)], ids);
  assert.equal(set[0].role, "front");
  assert.equal(set[0].position, 0);
  // The fallback takes a photo no role claimed rather than stealing one.
  assert.ok(!["a", "b"].includes(set[0].mediaId));
});

test("front falls back even when every proposal is unusable", () => {
  const set = assignRoles([proposal("a", null, 0.1), proposal("b", null, 0.2)], ["a", "b"]);
  assert.deepEqual(set, [{ mediaId: "b", role: "front", position: 0 }]);
});

test("no photos means no set rather than a crash", () => {
  assert.deepEqual(assignRoles([], []), []);
});

test("a proposal for a photo that is not hers is dropped", () => {
  const clean = cleanProposals([proposal("zzz", "front"), proposal("a", "front")], ids);
  assert.deepEqual(clean.map((item) => item.mediaId), ["a"]);
  assert.deepEqual(assignRoles([proposal("zzz", "front")], []), []);
});

test("a nonsense role or confidence is tidied instead of thrown away", () => {
  const clean = cleanProposals(
    [{ mediaId: "a", role: "sideways", confidence: Number.NaN, note: "  a note  " }],
    ids,
  );
  assert.deepEqual(clean, [{ mediaId: "a", role: null, confidence: 0.5, note: "a note" }]);
});

test("confidence is clamped so a model cannot out-vote every other photo", () => {
  const clean = cleanProposals([proposal("a", "front", 99), proposal("b", "front", -3)], ids);
  assert.deepEqual(clean.map((item) => item.confidence), [1, 0]);
});

test("a repeated photo keeps its first proposal", () => {
  const clean = cleanProposals([proposal("a", "front", 0.9), proposal("a", "profile", 0.2)], ids);
  assert.equal(clean.length, 1);
  assert.equal(clean[0].role, "front");
});

test("her taps are read in casting order and can leave roles empty", () => {
  const set = assignmentsFromForm({ front: "c", profile: "a", expression: "" }, ids);
  assert.deepEqual(set, [
    { mediaId: "c", role: "front", position: 0 },
    { mediaId: "a", role: "profile", position: 1 },
  ]);
});

test("the same photo tapped for two roles keeps the first", () => {
  const set = assignmentsFromForm({ front: "a", three_quarter: "a", profile: "b" }, ids);
  assert.deepEqual(set, [
    { mediaId: "a", role: "front", position: 0 },
    { mediaId: "b", role: "profile", position: 1 },
  ]);
});

test("an id that is not one of her photos never reaches the database", () => {
  assert.deepEqual(assignmentsFromForm({ front: "someone-elses-photo" }, ids), []);
});

test("the casting order is the order the image model is given", () => {
  assert.deepEqual([...ROLE_ORDER], ["front", "three_quarter", "profile", "full_body", "expression"]);
});

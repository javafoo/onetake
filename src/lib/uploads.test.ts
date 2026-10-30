import assert from "node:assert/strict";
import { test } from "node:test";

import {
  avatarFilterFrom,
  canCopy,
  copiedMeta,
  copyNote,
  copyResultMessage,
  copyRoot,
  planCopies,
  uploadGroup,
  uploadGroupFrom,
  uploadsHref,
  uploadsView,
} from "./uploads";

/* The Uploads tab's groups and the rules for copying an upload to another avatar. */

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

type R = { id: string; kind: string; avatarId: string | null; meta: Record<string, unknown>; bytes: number };
const place = (id: string, avatarId: string | null = A, extra: Record<string, unknown> = {}): R => ({ id, kind: "image", avatarId, meta: { source: "upload", subject: "scene", ...extra }, bytes: 400_000 });
const me = (id: string, avatarId: string | null = A): R => ({ id, kind: "image", avatarId, meta: { source: "upload" }, bytes: 400_000 });
const clip = (id: string, avatarId: string | null = A, bytes = 20_000_000): R => ({ id, kind: "clip", avatarId, meta: { source: "upload" }, bytes });
const made = (id: string): R => ({ id, kind: "image", avatarId: A, meta: { idea: "a café" }, bytes: 400_000 });

test("an upload is grouped by what the generators read; anything made here is in no group", () => {
  assert.equal(uploadGroup(place("p")), "places");
  assert.equal(uploadGroup(me("m")), "me");
  assert.equal(uploadGroup(clip("c")), "clips");
  assert.equal(uploadGroup(made("x")), null);
  assert.equal(uploadGroup({ kind: "upload", meta: { source: "upload" } }), null);
  assert.equal(uploadGroup({ kind: "image", meta: null }), null);
});

test("the URL picks a group or an avatar only when it names a real one", () => {
  assert.equal(uploadGroupFrom("places"), "places");
  assert.equal(uploadGroupFrom("nope"), null);
  assert.equal(uploadGroupFrom(undefined), null);
  assert.equal(avatarFilterFrom(B, [{ id: A }, { id: B }]), B);
  assert.equal(avatarFilterFrom("someone-elses", [{ id: A }]), null);
  assert.equal(uploadsHref({}), "/library/uploads");
  assert.equal(uploadsHref({ group: "places", avatarId: B }), `/library/uploads?group=places&avatar=${B}`);
});

test("the view groups, filters by avatar, and counts what each chip opens", () => {
  const rows = [place("p1"), place("p2", B), me("m1"), clip("c1", B), made("x"), place("old", null)];
  const all = uploadsView(rows, { group: null, avatarId: null });
  assert.deepEqual(all.items.places.map((row) => row.id), ["p1", "p2", "old"]);
  assert.deepEqual(all.counts, { places: 3, me: 1, clips: 1, all: 5 });

  // A row with no avatar is every avatar's, as on every other shelf.
  const onB = uploadsView(rows, { group: null, avatarId: B });
  assert.deepEqual(onB.items.places.map((row) => row.id), ["p2", "old"]);
  assert.deepEqual(onB.counts, { places: 2, me: 0, clips: 1, all: 3 });

  const placesOnly = uploadsView(rows, { group: "places", avatarId: null });
  assert.deepEqual(placesOnly.items.me, []);
  assert.deepEqual(placesOnly.items.clips, []);
  assert.equal(placesOnly.counts.me, 1, "the other chips still say what they hold");
});

test("places, things and clips can be copied; photos of her and made photos cannot", () => {
  assert.equal(canCopy(place("p")), true);
  assert.equal(canCopy(clip("c")), true);
  assert.equal(canCopy(me("m")), false);
  assert.equal(canCopy(made("x")), false);
});

test("a copy remembers the first upload in the chain and drops the heart", () => {
  const now = new Date("2026-09-25T10:00:00Z");
  const first = place("p1", A, { favorite: true, description: "a desk by a window", safety: { ok: true } });
  const meta = copiedMeta(first, now);
  assert.equal(meta.copiedFrom, "p1");
  assert.equal(meta.subject, "scene");
  assert.equal(meta.source, "upload");
  assert.equal(meta.description, "a desk by a window");
  assert.equal(meta.copiedAt, now.toISOString());
  assert.equal("favorite" in meta, false);

  const second = { id: "p2", meta };
  assert.equal(copyRoot(second), "p1");
  assert.equal(copiedMeta(second, now).copiedFrom, "p1");
  assert.equal(copyRoot(place("p3")), "p3");
});

test("the plan skips what the avatar already has, refuses photos of her, and stops at the size of a press", () => {
  const rows = [place("p1"), place("p2"), me("m1"), place("p3", B), { ...place("p4"), meta: { source: "upload", subject: "scene", copiedFrom: "p1" } }, clip("c1")];
  const plan = planCopies(rows, B, new Set(["p2"]));
  assert.deepEqual(plan.copy.map((row) => row.id), ["p1", "c1"]);
  // p2 is on B already, p3 is B's own, p4 is a copy of p1 which this press copies.
  assert.equal(plan.already, 3);
  assert.equal(plan.refused, 1);
  assert.equal(plan.later, 0);

  const many = Array.from({ length: 5 }, (_, index) => place(`p${index}`));
  const capped = planCopies(many, B, new Set(), { items: 3, bytes: Number.POSITIVE_INFINITY });
  assert.equal(capped.copy.length, 3);
  assert.equal(capped.later, 2);

  const clips = [clip("c1", A, 90_000_000), clip("c2", A, 90_000_000), clip("c3", A, 200_000_000)];
  const byBytes = planCopies(clips, B, new Set(), { items: 20, bytes: 150_000_000 });
  assert.deepEqual(byBytes.copy.map((row) => row.id), ["c1"]);
  assert.equal(byBytes.later, 2);

  // One clip larger than a press still goes on its own.
  assert.deepEqual(planCopies([clip("big", A, 200_000_000)], B, new Set(), { items: 20, bytes: 150_000_000 }).copy.map((row) => row.id), ["big"]);
});

test("a second press copies nothing", () => {
  const plan = planCopies([place("p1")], B, new Set(["p1"]));
  assert.equal(plan.copy.length, 0);
  assert.equal(plan.already, 1);
});

test("what she reads before and after", () => {
  assert.equal(copyResultMessage({ copied: 2, already: 1, refused: 0, later: 0, full: false }, "Mia"), "Copied 2 items to Mia. 1 was already there.");
  assert.equal(copyResultMessage({ copied: 1, already: 0, refused: 2, later: 3, full: false }, "Mia"), "Copied 1 item to Mia. 2 photos of you stay where they are. Select the other 3 and copy again.");
  assert.equal(copyResultMessage({ copied: 0, already: 0, refused: 0, later: 4, full: true }, "Mia"), "There is no room for more uploads. Delete some you added to copy the rest.");
  assert.equal(copyResultMessage({ copied: 0, already: 0, refused: 0, later: 0, full: false }, "Mia"), "Nothing to copy to Mia.");
  assert.match(copyNote("places", "Mia", 200), /^Mia can use it in carousels too\. Free\. The copy counts as one of your 200 uploads\.$/);
  assert.match(copyNote("clips", null, 200), /^The avatar you pick can use it in reels too\./);
});

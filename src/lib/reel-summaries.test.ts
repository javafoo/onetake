import assert from "node:assert/strict";
import { test } from "node:test";

import type { Draft } from "@/data/drafts";
import type { Media } from "@/data/media";

import { reelSummaries } from "./reel-summaries";

/* The Reels page's join: a reel draft and the reel it produced, as one card.
   What is left out matters as much as what is kept: a draft with no reel, a
   reel that is gone or on another avatar, and a carousel. */

const draft = (id: string, patch: Partial<Draft> = {}): Draft => ({
  id,
  userId: "user_1",
  avatarId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  format: "reel",
  hook: `Hook ${id}`,
  angle: "privacy",
  caption: "Here is how.",
  cta: "Comment AVATAR.",
  spec: null,
  status: "assembled",
  clipMediaId: `clip_${id}`,
  outputMediaId: `reel_${id}`,
  reelSeconds: null,
  createdAt: new Date(2026, 8, 1),
  updatedAt: new Date(2026, 8, 1),
  ...patch,
});

const reel = (id: string, createdAt: Date, patch: Partial<Media> = {}): Media => ({
  id,
  userId: "user_1",
  avatarId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  folderId: null,
  kind: "reel",
  pathname: `users/user_1/reel/${id}.mp4`,
  contentType: "video/mp4",
  bytes: 1000,
  width: 1080,
  height: 1920,
  durationSeconds: "7.500",
  meta: {},
  createdAt,
  ...patch,
});

test("joins each reel draft to its reel, newest reel first", () => {
  const summaries = reelSummaries(
    [draft("a"), draft("b", { status: "assembled" })],
    [reel("reel_a", new Date(2026, 8, 2)), reel("reel_b", new Date(2026, 8, 3), { folderId: "f1", meta: { favorite: true } })],
    new Map([["f1", "Beach day"]]),
  );
  assert.deepEqual(summaries.map((item) => item.draftId), ["b", "a"]);
  const [b, a] = summaries;
  assert.equal(b.mediaId, "reel_b");
  assert.equal(b.src, "/api/media/reel_b");
  assert.equal(b.folderName, "Beach day");
  assert.equal(b.favorite, true);
  assert.equal(b.seconds, 7.5);
  assert.equal(b.caption, "Here is how.\n\nComment AVATAR.");
  assert.equal(a.folderName, null);
  assert.equal(a.favorite, false);
  assert.equal(a.clipMediaId, "clip_a");
});

test("leaves out a draft with no reel, a reel that is not in the list, and a carousel", () => {
  const summaries = reelSummaries(
    [draft("none", { outputMediaId: null }), draft("gone"), draft("set", { format: "carousel", outputMediaId: "reel_set" })],
    [reel("reel_set", new Date())],
  );
  assert.deepEqual(summaries, []);
});

test("a draft edited after its reel was made is marked stale, and a reel with no length has none", () => {
  const [item] = reelSummaries([draft("a", { status: "draft" })], [reel("reel_a", new Date(), { durationSeconds: null })]);
  assert.equal(item.stale, true);
  assert.equal(item.seconds, null);
  assert.equal(item.folderName, null, "a folder that is not in the map has no name");
});

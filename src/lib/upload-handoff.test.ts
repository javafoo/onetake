import assert from "node:assert/strict";
import test from "node:test";

import {
  bodyTooLargeMessage,
  checkUploadClaim,
  ownsTmpUpload,
  REQUEST_BODY_LIMIT,
  tmpUploadPathname,
} from "./upload-handoff";
import { MAX_VIDEO_BYTES } from "./video-bytes";

/* The pathname a browser sends back after a direct upload is the one thing in
   the finish call that decides which object is read and deleted. These are
   the shapes it must and must not be allowed to take. */

const me = "user_2abcDEF";
const mine = tmpUploadPathname(me, "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b", "video/mp4");

test("a temporary pathname sits one segment under the owner's tmp prefix", () => {
  assert.equal(mine, "users/user_2abcDEF/tmp/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b.mp4");
  assert.equal(tmpUploadPathname(me, "abcdefgh", "video/quicktime"), "users/user_2abcDEF/tmp/abcdefgh.mov");
  assert.throws(() => tmpUploadPathname(me, "abcdefgh", "application/zip"));
});

test("the owner's own temporary upload passes", () => {
  assert.equal(ownsTmpUpload(me, mine), true);
});

test("another user's upload is refused, whoever asks", () => {
  assert.equal(ownsTmpUpload("user_other", mine), false);
  assert.equal(ownsTmpUpload(me, tmpUploadPathname("user_other", "abcdefgh", "video/mp4")), false);
});

test("a key outside tmp/ is refused even under the owner's prefix", () => {
  assert.equal(ownsTmpUpload(me, "users/user_2abcDEF/clip/abcdefgh.mp4"), false);
  assert.equal(ownsTmpUpload(me, "users/user_2abcDEF/abcdefgh.mp4"), false);
});

test("traversal, nesting and odd names are refused", () => {
  assert.equal(ownsTmpUpload(me, "users/user_2abcDEF/tmp/../clip/abcdefgh.mp4"), false);
  assert.equal(ownsTmpUpload(me, "users/user_2abcDEF/tmp/deeper/abcdefgh.mp4"), false);
  assert.equal(ownsTmpUpload(me, "users/user_2abcDEF/tmp/abcdefgh.mp4/"), false);
  assert.equal(ownsTmpUpload(me, "users/user_2abcDEF/tmp/abcdefgh.exe"), false);
  assert.equal(ownsTmpUpload(me, "users/user_2abcDEF/tmp/short.mp4"), false);
  assert.equal(ownsTmpUpload(me, "users/user_2abcDEF/tmp/"), false);
  assert.equal(ownsTmpUpload(me, ""), false);
  assert.equal(ownsTmpUpload(me, null), false);
  assert.equal(ownsTmpUpload(me, 42), false);
  assert.equal(ownsTmpUpload("", "users//tmp/abcdefgh.mp4"), false);
});

test("a prefix that merely starts the same is not the same user", () => {
  assert.equal(ownsTmpUpload("user_2abc", mine), false);
});

test("the claim check accepts the two containers under the video cap", () => {
  assert.deepEqual(checkUploadClaim({ type: "video/mp4", bytes: 20 * 1024 * 1024 }), {
    ok: true,
    contentType: "video/mp4",
    kind: "clip",
  });
  assert.deepEqual(checkUploadClaim({ type: "video/mov", bytes: 1024 }), {
    ok: true,
    contentType: "video/quicktime",
    kind: "clip",
  });
  assert.deepEqual(checkUploadClaim({ type: "image/jpeg", bytes: 1024 }), {
    ok: true,
    contentType: "image/jpeg",
    kind: "image",
  });
});

test("the claim check refuses what the in-request path would refuse", () => {
  const big = checkUploadClaim({ type: "video/mp4", bytes: MAX_VIDEO_BYTES + 1 });
  assert.equal(big.ok, false);
  if (!big.ok) assert.equal(big.status, 413);

  const wrong = checkUploadClaim({ type: "video/webm", bytes: 1024 });
  assert.equal(wrong.ok, false);
  if (!wrong.ok) assert.equal(wrong.status, 415);

  const empty = checkUploadClaim({ type: "video/mp4", bytes: 0 });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.status, 400);

  const fraction = checkUploadClaim({ type: "video/mp4", bytes: 1.5 });
  assert.equal(fraction.ok, false);
});

test("the body-too-large sentence names the platform limit", () => {
  assert.equal(REQUEST_BODY_LIMIT, 4718592);
  assert.equal(bodyTooLargeMessage(18 * 1024 * 1024), "That file is 18MB. 4.5MB is the most that can be sent this way.");
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { MediaLimitReachedError } from "@/data/media";
import { EmailNotVerifiedError } from "@/lib/email-gate";
import { InvalidRequestError } from "@/lib/errors";
import { UploadRejectedError } from "@/lib/image-bytes";
import { RateLimitedError } from "@/lib/rate-limit";
import { SafetyRefusalError } from "@/safety/refusals";

import { libraryFullMessage, rightsConfirmed, uploadRefusal } from "./store";

/* An upload's refusal as a status and a sentence: the same answer whether it
   becomes the upload routes' Response or a reply to a caller with no browser. */

test("each refusal keeps its status and its sentence", () => {
  assert.deepEqual(uploadRefusal(new RateLimitedError("Slow down.", "upload", 1000)), { status: 429, message: "Slow down." });
  assert.deepEqual(uploadRefusal(new EmailNotVerifiedError("Confirm your email first.")), { status: 403, message: "Confirm your email first." });
  assert.deepEqual(uploadRefusal(new SafetyRefusalError("nudity", "That photo cannot be used.")), { status: 422, message: "That photo cannot be used." });
  assert.deepEqual(uploadRefusal(new UploadRejectedError(413, "That file is too large.")), { status: 413, message: "That file is too large." });
  assert.deepEqual(uploadRefusal(new InvalidRequestError("Pick a file.")), { status: 400, message: "Pick a file." });
  assert.deepEqual(uploadRefusal(new MediaLimitReachedError(200)), { status: 409, message: libraryFullMessage() });
});

test("anything unexpected is a 500 that says nothing of what went wrong inside", () => {
  const original = console.error;
  console.error = () => undefined;
  try {
    const refusal = uploadRefusal(new Error("ENOENT /var/secret/path"));
    assert.equal(refusal.status, 500);
    assert.doesNotMatch(refusal.message, /secret/);
  } finally {
    console.error = original;
  }
});

test("the rights box counts only when it says yes", () => {
  assert.equal(rightsConfirmed("yes"), true);
  assert.equal(rightsConfirmed("on"), false);
  assert.equal(rightsConfirmed(true), false);
  assert.equal(rightsConfirmed(undefined), false);
});

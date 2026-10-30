import assert from "node:assert/strict";
import { test } from "node:test";

import { checkUpload, MAX_BYTES, MAX_PHOTOS, photoCountMessage } from "./photos";

const upload = (patch: Partial<Parameters<typeof checkUpload>[0]> = {}) =>
  checkUpload({ contentType: "image/jpeg", bytes: 400_000, existing: 0, consented: true, ...patch });

test("a normal downscaled photo is accepted", () => {
  assert.deepEqual(upload(), { ok: true });
  assert.deepEqual(upload({ contentType: "image/png" }), { ok: true });
  assert.deepEqual(upload({ contentType: "image/webp" }), { ok: true });
  assert.deepEqual(upload({ contentType: "IMAGE/JPEG; charset=binary" }), { ok: true });
});

test("nothing is stored without consent, whatever the file is", () => {
  const verdict = upload({ consented: false });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.status, 403);
});

test("consent is checked before the file, so a bad file still says the real reason", () => {
  const verdict = upload({ consented: false, contentType: "application/pdf", bytes: MAX_BYTES * 2 });
  assert.equal(verdict.ok === false && verdict.status, 403);
});

test("only photographs", () => {
  for (const contentType of ["application/pdf", "image/heic", "video/mp4", "text/html", ""]) {
    const verdict = upload({ contentType });
    assert.equal(verdict.ok, false, contentType);
    assert.equal(verdict.ok === false && verdict.status, 415, contentType);
  }
});

test("size has a floor and a ceiling", () => {
  assert.equal(upload({ bytes: MAX_BYTES + 1 }).ok, false);
  assert.equal(upload({ bytes: MAX_BYTES }).ok, true);
  assert.equal(upload({ bytes: 100 }).ok, false);
});

test("the sixteenth photo is refused", () => {
  assert.equal(upload({ existing: MAX_PHOTOS - 1 }).ok, true);
  const verdict = upload({ existing: MAX_PHOTOS });
  assert.equal(verdict.ok === false && verdict.status, 409);
});

test("the count line counts down in her words", () => {
  assert.match(photoCountMessage(0), /Add 5 to 15/);
  assert.match(photoCountMessage(4), /1 more photo\b/);
  assert.match(photoCountMessage(3), /2 more photos\b/);
  assert.match(photoCountMessage(5), /carry on/);
  assert.match(photoCountMessage(15), /0 more/);
});

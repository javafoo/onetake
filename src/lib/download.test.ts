import assert from "node:assert/strict";
import { test } from "node:test";

import { downloadFilename, downloadHref, mediaDisposition, wantsDownload } from "./download";

const ID = "3f2a9c1e-8b7d-4c6a-9e1f-2a3b4c5d6e7f";

test("the download link goes through the owner-checked media route and asks to save", () => {
  assert.equal(downloadHref(ID), `/api/media/${ID}?download=1`);
  assert.equal(wantsDownload(`https://app.example${downloadHref(ID)}`), true);
  assert.equal(wantsDownload(`https://app.example/api/media/${ID}`), false);
  assert.equal(wantsDownload(`https://app.example/api/media/${ID}?download=yes`), false);
});

test("the filename is what it is and a short id, or the name she uploaded it as, cleaned", () => {
  assert.equal(downloadFilename({ id: ID, kind: "image", extension: "png" }), "photo-3f2a9c1e.png");
  assert.equal(downloadFilename({ id: ID, kind: "reel", extension: "mp4" }), "reel-3f2a9c1e.mp4");
  assert.equal(downloadFilename({ id: ID, kind: "slide", extension: "png" }), "slide-3f2a9c1e.png");
  assert.equal(downloadFilename({ id: ID, kind: "image", extension: "jpg", originalName: "Beach day (2).HEIC" }), "Beach-day-2.jpg");
  assert.equal(downloadFilename({ id: ID, kind: "image", extension: "jpg", originalName: '../"evil";.jpg' }), "evil.jpg");
  assert.equal(downloadFilename({ id: ID, kind: "clip", extension: "mp4", originalName: "日本" }), "clip-3f2a9c1e.mp4");
});

test("the disposition saves only when asked", () => {
  assert.equal(mediaDisposition(true, "photo-1.png"), 'attachment; filename="photo-1.png"');
  assert.equal(mediaDisposition(false, "photo-1.png"), 'inline; filename="photo-1.png"');
});

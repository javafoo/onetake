import assert from "node:assert/strict";
import { test } from "node:test";

import { photosFor, photoShelf, shelfCounts, shelfFrom } from "./shelves";

/* Which shelf a photo is on, worked out from the photo alone. */

const made = (id: string, folderId: string | null = null) => ({ id, folderId, meta: { idea: "a café" } });
const upload = (id: string, folderId: string | null = null, subject?: string) => ({ id, folderId, meta: { source: "upload", ...(subject ? { subject } : {}) } });
const words = (id: string, folderId: string | null = null, source?: string) => ({ id, folderId, meta: { words: { text: "a quote" }, ...(source ? { source } : {}) } });

const rows = [made("a", "beach"), made("b"), upload("c"), upload("d", "beach", "scene"), words("e", "beach"), words("f", null, "upload")];

test("words win over an upload; anything else the app made is on the main grid", () => {
  assert.equal(photoShelf(made("x").meta), "made");
  assert.equal(photoShelf(upload("x", null, "scene").meta), "uploads");
  assert.equal(photoShelf(words("x", null, "upload").meta), "words");
  assert.equal(photoShelf(null), "made");
});

test("the main grid and every folder show only photos the app made", () => {
  assert.deepEqual(photosFor(rows, { shelf: null, folder: undefined }).map((row) => row.id), ["a", "b"]);
  assert.deepEqual(photosFor(rows, { shelf: null, folder: "beach" }).map((row) => row.id), ["a"]);
  assert.deepEqual(photosFor(rows, { shelf: null, folder: null }).map((row) => row.id), ["b"]);
});

test("a shelf shows its photos from every folder", () => {
  assert.deepEqual(photosFor(rows, { shelf: "uploads", folder: undefined }).map((row) => row.id), ["c", "d"]);
  assert.deepEqual(photosFor(rows, { shelf: "words", folder: undefined }).map((row) => row.id), ["e", "f"]);
});

test("the counts on the chips are the photos each view shows", () => {
  assert.deepEqual(shelfCounts(rows), { made: 2, uploads: 2, words: 2, byFolder: { beach: 1 }, unfiled: 1 });
});

test("a shelf in the URL is one of the two, or the main grid", () => {
  assert.equal(shelfFrom("uploads"), "uploads");
  assert.equal(shelfFrom("words"), "words");
  assert.equal(shelfFrom("made"), null);
  assert.equal(shelfFrom(undefined), null);
});

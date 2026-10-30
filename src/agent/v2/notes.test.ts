import assert from "node:assert/strict";
import { test } from "node:test";

import { createNoteFilter, stripNotes } from "./notes";

const OFFERED = "[Offered: A photo: Maya by a pillar, 2 credits. she accepted it. Offer id f9c27cc4-4c3e-4c5b-91c0-bb60b7ca0041.]";
const STARTED = "[Started: image, 2 credits, job c0dfd044-fbb7-458b-90f7-66a9d9e6022e.]";

function run(pieces: string[]): string {
  let out = "";
  const filter = createNoteFilter((piece) => (out += piece));
  for (const piece of pieces) filter.push(piece);
  filter.end();
  return out;
}

test("notes at the start of a stored reply are dropped, the words after them kept", () => {
  assert.equal(stripNotes(`${OFFERED}${STARTED}This will make 1 photo for 2 credits.`), "This will make 1 photo for 2 credits.");
  assert.equal(stripNotes("This will make 1 photo."), "This will make 1 photo.");
});

test("a note in the middle of a reply is left alone: only a leading one is the model copying the format", () => {
  assert.equal(stripNotes(`Done. ${OFFERED}`), `Done. ${OFFERED}`);
});

test("streamed in any size of piece, the notes never reach the browser", () => {
  const text = `${OFFERED}${STARTED}This will make 1 photo for 2 credits.`;
  for (const size of [1, 3, 7, 40, 500]) {
    const pieces = text.match(new RegExp(`[\\s\\S]{1,${size}}`, "g")) ?? [];
    assert.equal(run(pieces), "This will make 1 photo for 2 credits.", `piece size ${size}`);
  }
});

test("ordinary text streams straight through, even text that starts with a bracket", () => {
  assert.equal(run(["Here ", "you go."]), "Here you go.");
  assert.equal(run(["[A ", "quick note] first"]), "[A quick note] first");
  assert.equal(run(["[Off", "ice hours] are 9 to 5"]), "[Office hours] are 9 to 5");
});

test("a reply that ends part-way through what might have been a note is still shown", () => {
  assert.equal(run(["[Offered: never closed"]), "[Offered: never closed");
});

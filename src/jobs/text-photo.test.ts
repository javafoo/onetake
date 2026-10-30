import assert from "node:assert/strict";
import { test } from "node:test";

import { createCanvas } from "@napi-rs/canvas";

import { renderTextOnPhoto } from "@/carousel/render";
import { resolveKit } from "@/carousel/kits";
import { textPhotoFrame, textPhotoLines } from "@/carousel/text-photo";

import { makeTextPhoto, NOT_YOUR_PHOTO, type SourcePhoto, type TextPhotoDeps } from "./text-photo";
import type { JobRecord, TextPhotoJobInput } from "./types";

const QUOTE = "this era is called: moving like i should have been a long time ago & never looking back.";
const HER = "user_her";
const OTHER = "user_other";

function job(userId = HER): JobRecord {
  const now = new Date();
  return {
    id: "job_1", userId, avatarId: "avatar_1", kind: "text_photo", status: "running", requestId: "r1", provider: null, providerRequestId: null,
    input: { kind: "text_photo", photoMediaId: "photo_1", text: QUOTE, style: "serif" }, output: null, error: null, credits: 0, createdAt: now, updatedAt: now,
  };
}

/* Her one photo, filed in a folder; the store answers only its owner. */
function fakes() {
  const photo: SourcePhoto & { userId: string } = {
    id: "photo_1", userId: HER, kind: "image", avatarId: "avatar_1", folderId: "folder_beach", width: 1664, height: 2080, meta: { idea: "on the beach at sunset", keep: true },
  };
  const drawn: Parameters<TextPhotoDeps["draw"]>[0][] = [];
  const saved: Parameters<TextPhotoDeps["save"]>[1][] = [];
  const deps: TextPhotoDeps = {
    async photo(userId, mediaId) { return userId === photo.userId && mediaId === photo.id ? photo : null; },
    async read() { return Buffer.from("jpeg bytes"); },
    size: () => null,
    async face() { return { top: 0.1, bottom: 0.35, left: 0.3, right: 0.7 }; },
    async draw(input) { drawn.push(input); return Buffer.from("png"); },
    async save(_userId, input) { saved.push(input); return { id: "worded_1" }; },
  };
  return { photo, drawn, saved, deps };
}

const input = (patch: Partial<TextPhotoJobInput> = {}): TextPhotoJobInput => ({ kind: "text_photo", photoMediaId: "photo_1", text: QUOTE, style: "serif", ...patch });

test("a photo that is not hers is refused, and nothing is drawn or saved", async () => {
  const { deps, drawn, saved } = fakes();
  await assert.rejects(makeTextPhoto(job(OTHER), input(), deps), { message: NOT_YOUR_PHOTO });
  await assert.rejects(makeTextPhoto(job(), input({ photoMediaId: "someone_elses" }), deps), { message: NOT_YOUR_PHOTO });
  assert.equal(drawn.length, 0);
  assert.equal(saved.length, 0);
});

test("a rejected take, a clip, or another avatar's photo is refused too", async () => {
  for (const patch of [{ meta: { keep: false } }, { kind: "clip" }, { avatarId: "avatar_2" }]) {
    const { deps, photo } = fakes();
    Object.assign(photo, patch);
    await assert.rejects(makeTextPhoto(job(), input(), deps), { message: NOT_YOUR_PHOTO });
  }
});

test("draws one image of her words, untouched, and files it beside her photo for free", async () => {
  const { deps, drawn, saved } = fakes();
  const outcome = await makeTextPhoto(job(), input({ text: "Soft *Life*\nHARD work" }), deps);
  assert.equal(drawn.length, 1);
  assert.equal(saved.length, 1);
  assert.deepEqual(outcome.mediaIds, ["worded_1"]);
  assert.equal(outcome.costUsd, 0);
  assert.deepEqual(drawn[0].lines, ["Soft *Life*", "HARD work"], "her case, her break, her asterisks");
  assert.equal(drawn[0].style, "serif");
  assert.deepEqual(drawn[0].face, { top: 0.1, bottom: 0.35, left: 0.3, right: 0.7 });
  assert.equal(saved[0].folderId, "folder_beach", "the same folder as the source");
  assert.equal(saved[0].avatarId, "avatar_1");
  assert.equal((saved[0].meta.words as { text: string }).text, "Soft *Life*\nHARD work");
  assert.equal(saved[0].meta.idea, "on the beach at sunset");
  assert.deepEqual(saved[0].meta.sourceMediaIds, ["photo_1"]);
});

test("the photo's own shape by default, the picked shape cut from the centre", async () => {
  const own = fakes();
  await makeTextPhoto(job(), input(), own.deps);
  assert.deepEqual({ w: own.drawn[0].frame.width, h: own.drawn[0].frame.height }, { w: 1080, h: 1350 });
  assert.equal(own.saved[0].width, 1664);
  const cut = fakes();
  await makeTextPhoto(job(), input({ aspect: "1:1" }), cut.deps);
  assert.equal(cut.drawn[0].frame.height, 1080);
  assert.equal(cut.saved[0].width, cut.saved[0].height);
});

test("the lines are her words: nothing added, dropped or re-cased, her breaks kept", () => {
  const lines = textPhotoLines(QUOTE);
  assert.ok(lines.length > 1, "a long line is wrapped");
  assert.equal(lines.join(" "), QUOTE);
  assert.deepEqual(textPhotoLines("THIS era\n\nis Mine"), ["THIS era", "is Mine"]);
});

test("the frame keeps the photo's resolution, up to a cap, and never shrinks the type", () => {
  assert.deepEqual(textPhotoFrame({ width: 1080, height: 1920 }), { width: 1080, height: 1920, scale: 1 });
  assert.deepEqual(textPhotoFrame({ width: 800, height: 1000 }), { width: 1080, height: 1350, scale: 1 });
  assert.equal(textPhotoFrame({ width: 6000, height: 8000 }).scale, 2);
  assert.deepEqual(textPhotoFrame({ width: 1600, height: 2000 }, "16:9"), { width: 1080, height: 608, scale: 1600 / 1080 });
});

test("the real renderer draws a PNG at the photo's own size in every look", async () => {
  const canvas = createCanvas(900, 1200);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#8a7d6b";
  ctx.fillRect(0, 0, 900, 1200);
  const photo = { data: canvas.toBuffer("image/jpeg"), face: { top: 0.1, bottom: 0.3, left: 0.35, right: 0.65 } };
  for (const style of ["bold", "pastel", "boxed", "serif", "serif_boxed"]) {
    const frame = textPhotoFrame({ width: 900, height: 1200 });
    const png = await renderTextOnPhoto({ kit: resolveKit(style), photo, lines: textPhotoLines(QUOTE), frame });
    assert.equal(png.subarray(1, 4).toString(), "PNG", style);
    assert.equal(png.readUInt32BE(16), 1080);
    assert.equal(png.readUInt32BE(20), 1440);
  }
});

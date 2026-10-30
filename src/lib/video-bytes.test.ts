import assert from "node:assert/strict";
import test from "node:test";

import {
  checkVideoShape,
  inspectVideoBytes,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  MAX_VIDEO_SIDE,
  MIN_VIDEO_BYTES,
  normaliseVideoType,
  requireDecodableVideo,
  sniffVideoType,
} from "./video-bytes";

/* Crafted headers, not real video. The point of this file is that a container
   is identified from its own bytes and everything else is refused before ffmpeg
   is allowed near it, and that is testable without a camera. */

/** An ISO base media header: size, "ftyp", a major brand, then compatible brands. */
function ftyp(major: string, compatible: string[] = [], padTo = MIN_VIDEO_BYTES): Buffer {
  const brands = Buffer.from(compatible.join(""), "ascii");
  const head = Buffer.alloc(16);
  head.writeUInt32BE(16 + brands.length, 0);
  head.write("ftyp", 4, "ascii");
  head.write(major, 8, "ascii");
  head.writeUInt32BE(0x200, 12); // minor version
  const body = Buffer.concat([head, brands]);
  return Buffer.concat([body, Buffer.alloc(Math.max(0, padTo - body.length), 0x21)]);
}

/** A classic QuickTime file: a bare atom with no ftyp in front of it. */
function atom(tag: string, padTo = MIN_VIDEO_BYTES): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8, 0);
  head.write(tag, 4, "ascii");
  return Buffer.concat([head, Buffer.alloc(Math.max(0, padTo - 8), 0x21)]);
}

const PNG_HEADER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(MIN_VIDEO_BYTES, 0x21),
]);

/**
 * A RIFF container of a given form: "AVI " for an AVI, "WEBP" for a WebP.
 *
 * Built byte by byte rather than from a string literal. The size field is four
 * zero bytes, and writing those as escapes inside a string puts real NUL bytes
 * into this source file, which makes git treat it as binary and stops it being
 * diffable or reviewable at all.
 */
function riff(form: string, padTo = MIN_VIDEO_BYTES): Buffer {
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(padTo - 8, 4);
  head.write(form, 8, "ascii");
  return Buffer.concat([head, Buffer.alloc(Math.max(0, padTo - 12), 0x21)]);
}

/* ------------------------------------------------------------------ */
/* The container                                                       */
/* ------------------------------------------------------------------ */

test("a crafted MP4 header is recognised as MP4", () => {
  assert.equal(sniffVideoType(ftyp("isom", ["isom", "iso2", "avc1", "mp41"])), "video/mp4");
  assert.equal(sniffVideoType(ftyp("mp42")), "video/mp4");
  assert.equal(sniffVideoType(ftyp("M4V ")), "video/mp4");
});

test("a QuickTime header is recognised as QuickTime, both shapes", () => {
  assert.equal(sniffVideoType(ftyp("qt  ")), "video/quicktime");
  // A classic MOV leads with a bare atom and has no ftyp at all.
  assert.equal(sniffVideoType(atom("moov")), "video/quicktime");
  assert.equal(sniffVideoType(atom("mdat")), "video/quicktime");
});

test("an unknown major brand is still accepted when it lists a known one behind it", () => {
  /* Real files do this: a vendor brand first, `isom` in the compatible list.
     Refusing them would be our bug, not theirs. */
  assert.equal(sniffVideoType(ftyp("XAVC", ["isom", "mp42"])), "video/mp4");
});

test("nothing else is a video, however much ffmpeg would like to open it", () => {
  // The formats ffmpeg would happily demux and that we have no reason to accept.
  assert.equal(sniffVideoType(PNG_HEADER), null, "PNG");
  assert.equal(sniffVideoType(riff("AVI ")), null, "AVI");
  assert.equal(sniffVideoType(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(60)])), null, "Matroska");
  assert.equal(sniffVideoType(Buffer.from("GIF89a".padEnd(64, "x"), "ascii")), null, "GIF");
  assert.equal(sniffVideoType(Buffer.alloc(64, 0x47)), null, "MPEG transport stream");
  assert.equal(sniffVideoType(ftyp("zzzz", ["yyyy"])), null, "an ISO file of a kind we do not take");
  assert.equal(sniffVideoType(Buffer.alloc(4)), null, "too short to say");
});

test("a large ftyp size cannot walk the brand scan through the whole file", () => {
  /* The compatible-brand scan is bounded by the box's declared size AND by a
     fixed ceiling, so a header claiming to be enormous cannot turn the scan
     into a search of the payload for something that looks like a brand. */
  const forged = ftyp("zzzz", [], 4096);
  forged.writeUInt32BE(0xffffffff, 0);
  forged.write("isom", 2000, "ascii");
  assert.equal(sniffVideoType(forged), null);
});

/* ------------------------------------------------------------------ */
/* The claimed type                                                    */
/* ------------------------------------------------------------------ */

test("a media type is read without its parameters or its case", () => {
  assert.equal(normaliseVideoType('video/mp4; codecs="avc1.42E01E"'), "video/mp4");
  assert.equal(normaliseVideoType("VIDEO/MP4"), "video/mp4");
  // What phones and Safari actually send for a MOV, none of it a real media type.
  assert.equal(normaliseVideoType("video/mov"), "video/quicktime");
  assert.equal(normaliseVideoType("video/x-quicktime"), "video/quicktime");
  assert.equal(normaliseVideoType("video/x-m4v"), "video/mp4");
});

test("a PNG named .mp4 is refused, and told which of the two it actually is", () => {
  const verdict = inspectVideoBytes(PNG_HEADER, "video/mp4");
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.status, 415);
  assert.match(verdict.message, /not an MP4 or MOV/);
});

test("a real MOV claiming to be an MP4 is refused rather than quietly corrected", () => {
  const verdict = inspectVideoBytes(ftyp("qt  "), "video/mp4");
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.status, 415);
  assert.match(verdict.message, /says it is video\/mp4 but its contents are video\/quicktime/);
});

test("the sniffed container wins, and is what comes back", () => {
  const verdict = inspectVideoBytes(ftyp("qt  "), "video/mov");
  assert.equal(verdict.ok, true);
  if (!verdict.ok) return;
  assert.equal(verdict.type, "video/quicktime");
});

test("no claimed type at all is fine: the bytes are the check that counts", () => {
  assert.deepEqual(inspectVideoBytes(ftyp("isom")), { ok: true, type: "video/mp4" });
});

/* ------------------------------------------------------------------ */
/* Size                                                               */
/* ------------------------------------------------------------------ */

test("a file too small to hold a video is refused before anything else", () => {
  const verdict = inspectVideoBytes(ftyp("isom", [], 100));
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.status, 400);
  assert.match(verdict.message, /too small/);
});

test("a file over the size ceiling is refused, and told the ceiling", () => {
  /* The bytes are never allocated: only the length matters, and the route
     refuses on the declared size before reading a body this big anyway. */
  const verdict = inspectVideoBytes({ byteLength: MAX_VIDEO_BYTES + 1, length: 64 } as unknown as Uint8Array);
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.status, 413);
  assert.match(verdict.message, /60MB is the most we can take/);
});

test("requireDecodableVideo throws the same decision the route would return", () => {
  assert.equal(requireDecodableVideo(ftyp("isom")), "video/mp4");
  assert.throws(() => requireDecodableVideo(PNG_HEADER, "video/mp4"), /not an MP4 or MOV/);
});

/* ------------------------------------------------------------------ */
/* What the probe found                                                */
/* ------------------------------------------------------------------ */

const shape = (patch: Partial<{ durationSeconds: number; width: number; height: number }> = {}) => ({
  durationSeconds: 8,
  width: 1080,
  height: 1920,
  ...patch,
});

test("an ordinary phone clip passes", () => {
  assert.deepEqual(checkVideoShape(shape()), { ok: true });
  assert.deepEqual(checkVideoShape(shape({ durationSeconds: MAX_VIDEO_SECONDS })), { ok: true }, "exactly the limit is allowed");
});

test("an over-long clip is refused, and told how long it is and what the limit is", () => {
  const verdict = checkVideoShape(shape({ durationSeconds: 41.7 }));
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.equal(verdict.status, 413);
  assert.match(verdict.message, /42 seconds/);
  assert.match(verdict.message, /30 seconds is the longest/);
});

test("a clip just over the limit is still over it", () => {
  assert.equal(checkVideoShape(shape({ durationSeconds: MAX_VIDEO_SECONDS + 0.1 })).ok, false);
});

test("a duration that could not be read is refused rather than stored as zero", () => {
  for (const durationSeconds of [0, -1, Number.NaN]) {
    const verdict = checkVideoShape(shape({ durationSeconds }));
    assert.equal(verdict.ok, false, `${durationSeconds}`);
    if (verdict.ok) return;
    assert.equal(verdict.status, 400);
  }
});

test("a clip with no readable picture, or an absurd one, is refused", () => {
  assert.equal(checkVideoShape(shape({ width: 0 })).ok, false);
  assert.equal(checkVideoShape(shape({ height: 0 })).ok, false);

  const huge = checkVideoShape(shape({ width: MAX_VIDEO_SIDE + 1 }));
  assert.equal(huge.ok, false);
  if (huge.ok) return;
  assert.equal(huge.status, 413);
  assert.match(huge.message, /4096 pixels/);
});

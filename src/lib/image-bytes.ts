/* What is actually in an uploaded file, read from the bytes rather than from
 * what the client said about them.
 *
 * The old rule trusted `file.type`. A browser sets it from the file extension,
 * a script sets it to whatever it likes, and the bytes were then stored
 * verbatim and later handed to ffmpeg. Two things follow from that: ffmpeg
 * would happily decode any container it recognises, not only the three formats
 * we accept, and a 30000x30000 PNG is a few kilobytes on disk and about
 * 3.6 gigabytes once decoded.
 *
 * So the order here is: sniff the magic bytes, read the dimensions out of the
 * header, refuse anything outrageous, and only then let a decoder near it.
 * Everything in this file is pure — no fs, no network, no child process — so
 * the refusals can be tested with crafted headers.
 */

import { UserFacingError } from "./errors";

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];

/** No camera and no phone produces a side longer than this. */
export const MAX_SIDE = 8000;
/** 40 megapixels is about 160MB decoded at 4 bytes a pixel. Past that, refuse. */
export const MAX_PIXELS = 40_000_000;

/** A refusal a person should read as written: it tells them what to do next. */
export class UploadRejectedError extends UserFacingError {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "UploadRejectedError";
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* Magic bytes                                                         */
/* ------------------------------------------------------------------ */

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(data: Uint8Array, bytes: number[], at = 0): boolean {
  if (data.length < at + bytes.length) return false;
  return bytes.every((byte, index) => data[at + index] === byte);
}

function ascii(data: Uint8Array, at: number, length: number): string {
  if (data.length < at + length) return "";
  return String.fromCharCode(...data.subarray(at, at + length));
}

/**
 * The format these bytes really are, or null.
 *
 * Only the three we accept are recognised. A GIF, a TIFF, an SVG, a PDF, an
 * MP4 or a zip all come back null, which is the point: ffmpeg would decode
 * several of those and we have no reason to let it try.
 */
export function sniffImageType(data: Uint8Array): AcceptedImageType | null {
  if (startsWith(data, JPEG)) return "image/jpeg";
  if (startsWith(data, PNG)) return "image/png";
  if (ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 4) === "WEBP") return "image/webp";
  return null;
}

/** `image/jpeg; charset=binary` and `IMAGE/JPEG` are the same claim. */
export function normaliseType(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Dimensions, from the header only                                    */
/* ------------------------------------------------------------------ */

export interface Dimensions {
  width: number;
  height: number;
}

/** PNG: IHDR is always the first chunk, and its two sizes are big-endian. */
function pngDimensions(data: Uint8Array): Dimensions | null {
  if (data.length < 24 || ascii(data, 12, 4) !== "IHDR") return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/* JPEG: walk the markers to the start-of-frame, which is the only segment that
   carries the size. Anything else is skipped by its own length, so a file with
   a megabyte of EXIF in front of the frame is still read from the header.
   C4 (Huffman tables), C8 (reserved) and CC (arithmetic coding) share the
   range but are not frames. */
const NOT_A_FRAME = new Set([0xc4, 0xc8, 0xcc]);

function jpegDimensions(data: Uint8Array): Dimensions | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 2; // past SOI
  while (at + 3 < data.length) {
    if (data[at] !== 0xff) {
      at += 1; // fill byte or padding; resynchronise
      continue;
    }
    const marker = data[at + 1];
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // Standalone markers carry no length.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      at += 2;
      continue;
    }
    if (at + 3 >= data.length) return null;
    const length = view.getUint16(at + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && !NOT_A_FRAME.has(marker)) {
      if (at + 9 > data.length) return null;
      return { height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
    }
    if (marker === 0xda) return null; // start of scan: past every header
    at += 2 + length;
  }
  return null;
}

/* WebP has three shapes and they disagree about where the size lives, so all
   three are read: a simple lossy frame, a lossless frame, and the extended
   container that an animation or an alpha channel produces. */
function webpDimensions(data: Uint8Array): Dimensions | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fourcc = ascii(data, 12, 4);

  if (fourcc === "VP8 ") {
    // 8 bytes of chunk header, 3 bytes frame tag, 3 bytes start code, then the sizes.
    if (data.length < 30) return null;
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }

  if (fourcc === "VP8L") {
    if (data.length < 25) return null;
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }

  if (fourcc === "VP8X") {
    if (data.length < 30) return null;
    const read24 = (at: number) => data[at] | (data[at + 1] << 8) | (data[at + 2] << 16);
    return { width: read24(24) + 1, height: read24(27) + 1 };
  }

  return null;
}

/** The declared size of an image, read from its header and nothing else. */
export function imageDimensions(data: Uint8Array, type: AcceptedImageType): Dimensions | null {
  const size =
    type === "image/png" ? pngDimensions(data) : type === "image/jpeg" ? jpegDimensions(data) : webpDimensions(data);
  if (!size) return null;
  if (!Number.isInteger(size.width) || !Number.isInteger(size.height)) return null;
  if (size.width <= 0 || size.height <= 0) return null;
  return size;
}

/* ------------------------------------------------------------------ */
/* The verdict                                                         */
/* ------------------------------------------------------------------ */

export type ImageVerdict =
  | { ok: true; type: AcceptedImageType; width: number; height: number }
  | { ok: false; status: number; message: string };

/**
 * Whether these bytes may be decoded at all.
 *
 * `claimedType` is only used to notice a disagreement; the sniffed type is the
 * one that counts and the one that is returned. A mismatch is refused rather
 * than silently corrected, because a file whose extension and contents
 * disagree is either broken or deliberate and neither is worth decoding.
 */
export function inspectImageBytes(data: Uint8Array, claimedType?: string): ImageVerdict {
  const type = sniffImageType(data);
  if (!type) {
    return { ok: false, status: 415, message: "That file is not a JPEG, PNG or WebP photo." };
  }
  if (claimedType && normaliseType(claimedType) !== type) {
    return {
      ok: false,
      status: 415,
      message: `That file says it is ${normaliseType(claimedType)} but its contents are ${type}. Save it again and try once more.`,
    };
  }

  const size = imageDimensions(data, type);
  if (!size) {
    return { ok: false, status: 400, message: "We could not read that photo's size. Save it again and try once more." };
  }
  if (size.width > MAX_SIDE || size.height > MAX_SIDE) {
    return {
      ok: false,
      status: 413,
      message: `That photo is ${size.width}x${size.height}. The longest side we can work with is ${MAX_SIDE} pixels.`,
    };
  }
  if (size.width * size.height > MAX_PIXELS) {
    return {
      ok: false,
      status: 413,
      message: `That photo is ${size.width}x${size.height}, which is more than ${MAX_PIXELS / 1_000_000} megapixels. Try one straight from your camera roll.`,
    };
  }

  return { ok: true, type, width: size.width, height: size.height };
}

/** The same decision as a throw, for callers that are inside a try block anyway. */
export function requireDecodableImage(data: Uint8Array, claimedType?: string): { type: AcceptedImageType } & Dimensions {
  const verdict = inspectImageBytes(data, claimedType);
  if (!verdict.ok) throw new UploadRejectedError(verdict.status, verdict.message);
  return { type: verdict.type, width: verdict.width, height: verdict.height };
}

/* What is actually in an uploaded video, read from the bytes rather than from
 * what the client said about them.
 *
 * This is `image-bytes.ts` for the other half of the Library: the same argument
 * applies and the stakes are higher. A browser sets `file.type` from the
 * extension, a script sets it to whatever it likes, and what follows is a
 * container handed to ffmpeg. ffmpeg will cheerfully open a Matroska, an AVI,
 * an MPEG transport stream or an image sequence; we accept two containers and
 * there is no reason to let it try the rest.
 *
 * So: sniff the container from its own header, refuse anything else, and only
 * then let a decoder near the file. Everything here is pure — no fs, no
 * network, no child process — so the refusals can be tested with crafted
 * headers rather than with real video.
 *
 * What this does NOT decide is whether the file decodes. That needs ffmpeg and
 * lives in `video-reencode.ts`.
 */

import { UploadRejectedError } from "./image-bytes";

export const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/quicktime"] as const;
export type AcceptedVideoType = (typeof ACCEPTED_VIDEO_TYPES)[number];

/** A phone clip is a few megabytes a second at worst. Sixty is a generous ceiling. */
export const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
/** Under this there is no video in the file, whatever its header claims. */
export const MIN_VIDEO_BYTES = 8 * 1024;
/** The longest clip the Library will hold. A reel is seconds long; this is plenty. */
export const MAX_VIDEO_SECONDS = 30;
/** No phone shoots wider than this. Past it, refuse before decoding. */
export const MAX_VIDEO_SIDE = 4096;

/* ------------------------------------------------------------------ */
/* The container                                                       */
/* ------------------------------------------------------------------ */

function ascii(data: Uint8Array, at: number, length: number): string {
  if (data.length < at + length) return "";
  return String.fromCharCode(...data.subarray(at, at + length));
}

/* ISO base media files — MP4 and modern MOV both — open with a `ftyp` box: a
   four-byte big-endian size, the tag, then a four-character major brand and a
   list of compatible brands. QuickTime's own brand is "qt  "; everything else
   here is the MP4 family as written by phones, cameras and editors. */
const MP4_BRANDS = new Set([
  "isom", "iso2", "iso4", "iso5", "iso6", "avc1", "mp41", "mp42", "mp71",
  "M4V ", "M4VH", "M4VP", "M4A ", "mmp4", "dash", "cmfc", "av01",
]);
const QUICKTIME_BRANDS = new Set(["qt  "]);

/* A classic QuickTime file has no `ftyp` at all: it is a bare sequence of
   atoms, and the first one is one of these. `mdat` first is unusual but legal
   (a file written while recording), so it is accepted here and left to ffmpeg
   to actually decode. */
const MOV_FIRST_ATOMS = new Set(["moov", "mdat", "free", "skip", "wide", "pnot"]);

/**
 * The container these bytes really are, or null.
 *
 * Only the two we accept are recognised. A Matroska, a WebM, an AVI, an MPEG
 * stream, a GIF or a JPEG all come back null, which is the point.
 */
export function sniffVideoType(data: Uint8Array): AcceptedVideoType | null {
  if (data.length < 12) return null;

  if (ascii(data, 4, 4) === "ftyp") {
    const major = ascii(data, 8, 4);
    if (QUICKTIME_BRANDS.has(major)) return "video/quicktime";
    if (MP4_BRANDS.has(major)) return "video/mp4";

    /* An unfamiliar major brand is still an MP4 if one of its compatible
       brands is one we know: a file can lead with a brand nobody has heard of
       and list `isom` behind it, which is exactly what the compatible list is
       for. Bounded to the box's own declared size so a large size field cannot
       walk us through the whole file. */
    const size = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0);
    const end = Math.min(size > 0 ? size : 0, data.length, 8 + 4 + 4 * 16);
    for (let at = 16; at + 4 <= end; at += 4) {
      const brand = ascii(data, at, 4);
      if (QUICKTIME_BRANDS.has(brand)) return "video/quicktime";
      if (MP4_BRANDS.has(brand)) return "video/mp4";
    }
    return null;
  }

  // Classic QuickTime: a bare atom, whose four-character tag comes after its size.
  if (MOV_FIRST_ATOMS.has(ascii(data, 4, 4))) return "video/quicktime";

  return null;
}

/** `video/mp4; codecs="avc1"` and `VIDEO/MP4` are the same claim. */
export function normaliseVideoType(contentType: string): string {
  const base = contentType.split(";")[0].trim().toLowerCase();
  /* What browsers and phones actually send for the two containers we take.
     `video/mov` is not a real media type but Safari and a few Android pickers
     send it anyway, and turning away a real MOV over that would be our bug. */
  if (base === "video/mov" || base === "video/x-quicktime") return "video/quicktime";
  if (base === "video/x-m4v") return "video/mp4";
  return base;
}

/* ------------------------------------------------------------------ */
/* The verdict                                                         */
/* ------------------------------------------------------------------ */

export type VideoVerdict =
  | { ok: true; type: AcceptedVideoType }
  | { ok: false; status: number; message: string };

/**
 * Whether these bytes may be handed to ffmpeg at all.
 *
 * `claimedType` is used only to notice a disagreement; the sniffed container is
 * the one that counts and the one that is returned. A mismatch is refused
 * rather than quietly corrected, because a file whose extension and contents
 * disagree is either broken or deliberate, and neither is worth decoding.
 */
export function inspectVideoBytes(data: Uint8Array, claimedType?: string): VideoVerdict {
  if (data.byteLength < MIN_VIDEO_BYTES) {
    return { ok: false, status: 400, message: "That file is too small to be a video." };
  }
  if (data.byteLength > MAX_VIDEO_BYTES) {
    return {
      ok: false,
      status: 413,
      message: `That clip is ${megabytes(data.byteLength)}MB. ${MAX_VIDEO_BYTES / 1024 / 1024}MB is the most we can take — trim it first, or pick a shorter one.`,
    };
  }

  const type = sniffVideoType(data);
  if (!type) return { ok: false, status: 415, message: "That file is not an MP4 or MOV video." };

  if (claimedType) {
    const claimed = normaliseVideoType(claimedType);
    if (claimed !== type) {
      return {
        ok: false,
        status: 415,
        message: `That file says it is ${claimed || "an unknown type"} but its contents are ${type}. Export it again and try once more.`,
      };
    }
  }

  return { ok: true, type };
}

export function megabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "");
}

/** The same decision as a throw, for callers already inside a try block. */
export function requireDecodableVideo(data: Uint8Array, claimedType?: string): AcceptedVideoType {
  const verdict = inspectVideoBytes(data, claimedType);
  if (!verdict.ok) throw new UploadRejectedError(verdict.status, verdict.message);
  return verdict.type;
}

/* ------------------------------------------------------------------ */
/* What a probe found                                                  */
/* ------------------------------------------------------------------ */

export interface VideoShape {
  durationSeconds: number;
  width: number;
  height: number;
}

/**
 * Whether a probed clip is one we will store. Pure, so the limits are tested
 * without ffmpeg: the probing itself is in `video-reencode.ts`.
 */
export function checkVideoShape(shape: VideoShape): { ok: true } | { ok: false; status: number; message: string } {
  if (!(shape.durationSeconds > 0)) {
    return { ok: false, status: 400, message: "We could not read how long that clip is. Export it again and try once more." };
  }
  if (shape.durationSeconds > MAX_VIDEO_SECONDS) {
    return {
      ok: false,
      status: 413,
      message: `That clip is ${Math.round(shape.durationSeconds)} seconds. ${MAX_VIDEO_SECONDS} seconds is the longest the library holds — trim it and upload it again.`,
    };
  }
  if (shape.width <= 0 || shape.height <= 0) {
    return { ok: false, status: 400, message: "That clip has no picture in it that we can read." };
  }
  if (shape.width > MAX_VIDEO_SIDE || shape.height > MAX_VIDEO_SIDE) {
    return {
      ok: false,
      status: 413,
      message: `That clip is ${shape.width}x${shape.height}. The longest side we can work with is ${MAX_VIDEO_SIDE} pixels.`,
    };
  }
  return { ok: true };
}

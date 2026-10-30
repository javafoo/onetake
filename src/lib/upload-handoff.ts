/* The rules of a two-step upload, with nothing behind them but strings.
 *
 * A clip off a phone is fifteen to thirty megabytes and Vercel refuses any
 * request body over 4.5MB before our code runs, so the browser cannot post a
 * clip to us. Instead it asks for a presigned URL (`/library/upload/start`),
 * PUTs the file straight into storage under a temporary key, and then asks us
 * to finish (`/library/upload/finish`). The second call names the key, and a
 * key from a browser is untrusted: this file is where it is checked.
 *
 * Everything here is pure so the owner rule can be proved in a test that
 * never touches a bucket.
 */

import { ACCEPTED_IMAGE_TYPES, normaliseType } from "./image-bytes";
import { userPrefix } from "./storage";
import { ACCEPTED_VIDEO_TYPES, MAX_VIDEO_BYTES, megabytes, normaliseVideoType } from "./video-bytes";

/** Vercel's ceiling on a function's request body. Anything larger is refused by the platform, not by us. */
export const REQUEST_BODY_LIMIT = Math.floor(4.5 * 1024 * 1024);

/** How long a presigned PUT stays valid. Long enough for a slow connection, short enough to be useless later. */
export const UPLOAD_URL_SECONDS = 10 * 60;

/** Where a not-yet-finished upload sits, under its owner's own prefix. */
export const TMP_SEGMENT = "tmp/";

/** The largest photo the old path takes; mirrors `MAX_BYTES` in the onboarding photo rules. */
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** One key segment: an id we minted plus an extension we know. No slashes, no dots elsewhere. */
const TMP_NAME = /^[A-Za-z0-9-]{8,}\.(mp4|mov|jpg|png|webp)$/;

export function tmpUploadPathname(userId: string, id: string, contentType: string): string {
  const extension = EXTENSIONS[contentType];
  if (!extension) throw new Error(`No temporary upload for ${contentType}`);
  return `${userPrefix(userId)}${TMP_SEGMENT}${id}.${extension}`;
}

/**
 * Whether `pathname` names a temporary upload that belongs to `userId`.
 *
 * It must sit exactly one segment under `users/<id>/tmp/`. A key under another
 * user, a key in the media area of this user, and anything with a `..` or an
 * extra slash in it are all refused, whatever the rest of the request says.
 */
export function ownsTmpUpload(userId: string, pathname: unknown): pathname is string {
  if (typeof pathname !== "string" || !userId) return false;
  const prefix = `${userPrefix(userId)}${TMP_SEGMENT}`;
  if (!pathname.startsWith(prefix)) return false;
  return TMP_NAME.test(pathname.slice(prefix.length));
}

export type UploadClaim = { type: string; bytes: number };

export type ClaimVerdict =
  | { ok: true; contentType: string; kind: "clip" | "image" }
  | { ok: false; status: number; message: string };

/**
 * Whether a file the browser describes is worth issuing an upload URL for.
 *
 * Only the claim is checked here — the type and size the browser reported.
 * The bytes are inspected again when they arrive, by the same code the
 * in-request path uses; this just saves a person the upload when the answer
 * is already no.
 */
export function checkUploadClaim(claim: UploadClaim): ClaimVerdict {
  const { bytes } = claim;
  if (!Number.isInteger(bytes) || bytes <= 0) return { ok: false, status: 400, message: "That file is empty." };

  const video = normaliseVideoType(claim.type);
  if ((ACCEPTED_VIDEO_TYPES as readonly string[]).includes(video)) {
    if (bytes > MAX_VIDEO_BYTES) {
      return {
        ok: false,
        status: 413,
        message: `That clip is ${megabytes(bytes)}MB. ${MAX_VIDEO_BYTES / 1024 / 1024}MB is the most we can take.`,
      };
    }
    return { ok: true, contentType: video, kind: "clip" };
  }

  const image = normaliseType(claim.type);
  if ((ACCEPTED_IMAGE_TYPES as readonly string[]).includes(image)) {
    if (bytes > MAX_PHOTO_BYTES) {
      return {
        ok: false,
        status: 413,
        message: `That photo is bigger than ${MAX_PHOTO_BYTES / 1024 / 1024}MB. Try one straight from your camera roll.`,
      };
    }
    return { ok: true, contentType: image, kind: "image" };
  }

  return { ok: false, status: 415, message: "That file is not a JPEG, PNG, WebP, MP4 or MOV." };
}

/** The sentence the in-request path answers with when a body is too big for the platform. */
export function bodyTooLargeMessage(bytes: number): string {
  return `That file is ${megabytes(bytes)}MB. ${megabytes(REQUEST_BODY_LIMIT)}MB is the most that can be sent this way.`;
}

import type { PhotoSubject } from "@/carousel/match";
import { deleteMedia, MediaLimitReachedError, saveMediaCappedAcross, UPLOAD_CAP, uploadByRequest, type Media } from "@/data/media";
import type { User } from "@/data/users";
import { EmailNotVerifiedError } from "@/lib/email-gate";
import { InvalidRequestError, userMessage } from "@/lib/errors";
import { UploadRejectedError } from "@/lib/image-bytes";
import { reencodeToJpeg } from "@/lib/image-reencode";
import { RateLimitedError } from "@/lib/rate-limit";
import { normaliseVideoType } from "@/lib/video-bytes";
import { remuxToMp4 } from "@/lib/video-reencode";
import { screenOnUpload } from "@/safety/gate";
import { SafetyRefusalError } from "@/safety/refusals";
import { lazySpend, type Spend } from "@/spend/lazy";

/* What happens to an uploaded file once we hold its bytes, whichever way they
 * arrived: in a multipart body (`src/app/library/upload/route.ts`), read back
 * from the temporary object a browser PUT into storage (`.../finish`), or
 * fetched for a caller with no browser. One function, so the paths cannot
 * drift in what they sniff, refuse, re-encode and store. It answers with data;
 * `storeUpload` in the app turns that into the routes' Response.
 *
 * What is stored is never what was sent, in either case:
 *
 *   A photo goes down the same path as an onboarding photo. The browser has
 *   already downscaled it to a 2048px JPEG and this assumes it did not: sniff
 *   the magic bytes, read the dimensions from the header, refuse anything
 *   absurd, decode once under an explicit format with a pixel ceiling and a
 *   timeout, and store the JPEG that comes out. Then screen it, like any other
 *   photograph of a person that lands in this account.
 *
 *   A clip is sniffed for an MP4 or MOV container, probed for its real length
 *   and picture size, refused past 60MB or 30 seconds, and re-muxed to MP4 with
 *   `-map_metadata -1` so the location in its QuickTime header does not come
 *   with it. Streams are copied, not re-encoded, so it costs a second.
 *
 * A clip is not screened by the vision model: the screen reads one still and a
 * clip is not one. Uploaded clips are footage she shot, they are only ever
 * shown back to her, and a hook printed over one is the only thing that leaves.
 * Worth knowing rather than worth hiding.
 */

/** Photos and clips share one allowance: it bounds the decoding, and both decode. */
export const UPLOAD_LIMIT = "upload";

/** Who the file belongs to and where it is filed. */
export type Destination = {
  user: User;
  avatarId: string;
  folderId: string | null;
  originalName: string;
  /** When she ticked "these are mine, or I have the rights"; stored on the row it covers, as onboarding does. */
  rightsConfirmedAt: string;
  /** "scene" when she said these are places and things rather than herself. Photos only. */
  subject?: PhotoSubject;
  /**
   * The caller's idempotency key, kept as `meta.requestId`. A second call with
   * the same key for the same user returns the first row and stores nothing.
   * The pages' uploads send none, as before.
   */
  requestId?: string;
};

export type UploadResult =
  | { ok: true; id: string; kind: "image" | "clip"; width: number; height: number; durationSeconds?: number }
  | { ok: false; status: number; message: string };

/* The box on the upload screen. The browser will not send without it; this is
   the check that counts, on every path a file can arrive by. */
export const RIGHTS_REQUIRED = "Tick the box to confirm you have the right to use these files.";

export function rightsConfirmed(value: unknown): boolean {
  return value === "yes";
}

export function libraryFullMessage(): string {
  return `You have added ${UPLOAD_CAP} photos and clips of your own, which is the most there is room for. Delete one you added to add another. Photos and clips made here do not count.`;
}

/** The one place an upload's refusal becomes a status and a sentence. */
export function uploadRefusal(error: unknown): { status: number; message: string } {
  if (error instanceof RateLimitedError) return { status: 429, message: error.message };
  if (error instanceof EmailNotVerifiedError) return { status: 403, message: error.message };
  if (error instanceof SafetyRefusalError) return { status: 422, message: error.message };
  if (error instanceof UploadRejectedError) return { status: error.status, message: error.message };
  if (error instanceof InvalidRequestError) return { status: 400, message: error.message };
  if (error instanceof MediaLimitReachedError) return { status: 409, message: libraryFullMessage() };
  return { status: 500, message: userMessage("library upload", error) };
}

/** A stored row as the answer to the call that stored it. */
function resultOf(row: Media): UploadResult {
  const kind = row.kind === "image" ? "image" : "clip";
  return {
    ok: true,
    id: row.id,
    kind,
    width: row.width ?? 0,
    height: row.height ?? 0,
    ...(kind === "clip" && row.durationSeconds != null ? { durationSeconds: Number(row.durationSeconds) } : {}),
  };
}

/**
 * Sniff, probe, re-encode, store and file one upload; the claimed type only
 * decides which path. A refusal the routes answer in words (the screen) comes
 * back as data; anything else is thrown, for `uploadRefusal` to word.
 */
export async function storeUploadResult(where: Destination, raw: Buffer, claimedType: string, deps: { spend?: Spend } = {}): Promise<UploadResult> {
  if (where.requestId) {
    const earlier = await uploadByRequest(where.user.id, where.requestId);
    if (earlier) return resultOf(earlier);
  }
  const wantsVideo = normaliseVideoType(claimedType).startsWith("video/");
  return wantsVideo ? storeClip(where, raw, claimedType) : storePhoto(where, raw, claimedType, deps.spend ?? lazySpend);
}

/* ------------------------------------------------------------------ */
/* Photos                                                             */
/* ------------------------------------------------------------------ */

async function storePhoto({ user, avatarId, folderId, originalName, rightsConfirmedAt, subject, requestId }: Destination, raw: Buffer, claimedType: string, spend: Spend): Promise<UploadResult> {
  const photo = await reencodeToJpeg(raw, { claimedType });

  /* Stored as `image`, the same kind a generated photo gets, because that is
     what decides where it appears: the Photos shelf, the animate picker and the
     carousel photo chooser all read that kind. `meta.source` is how an uploaded
     one can still be told apart. */
  const media = await saveMediaCappedAcross(user.id, {
    kind: "image",
    avatarId,
    folderId,
    data: photo.data,
    contentType: photo.contentType,
    width: photo.width,
    height: photo.height,
    meta: {
      source: "upload",
      rightsConfirmedAt,
      // Only a scene is marked: every photo without the mark is her, as every photo was before.
      ...(subject === "scene" ? { subject } : {}),
      originalName,
      original: { type: photo.originalType, width: photo.originalWidth, height: photo.originalHeight, bytes: raw.byteLength },
      ...(requestId ? { requestId } : {}),
    },
  });

  /* Screened after the row exists, so the verdict has somewhere to live and a
     refused photo is deleted rather than left half-stored. The check is a model
     call, so it takes from the vision allowance and counts against the daily
     cap like any other. */
  const screened = await spend(user, { limit: "vision", shape: "screen_photo" }, () =>
    screenOnUpload(user.id, media.id, { mimeType: photo.contentType, data: photo.data }));
  if (!screened.ok) {
    await deleteMedia(user.id, media.id);
    return { ok: false, status: 422, message: screened.message };
  }

  return { ok: true, id: media.id, kind: "image", width: photo.width, height: photo.height };
}

/* ------------------------------------------------------------------ */
/* Clips                                                              */
/* ------------------------------------------------------------------ */

async function storeClip({ user, avatarId, folderId, originalName, rightsConfirmedAt, requestId }: Destination, raw: Buffer, claimedType: string): Promise<UploadResult> {
  const clip = await remuxToMp4(raw, { claimedType });

  /* Stored as `clip` with its duration, which is what the reel assembler reads:
     an uploaded clip is eligible for a reel exactly like a generated one. No
     `faceZone` is written, so the first assembly that uses it finds one and
     caches it on the row — the same lazy path every clip already takes. */
  const media = await saveMediaCappedAcross(user.id, {
    kind: "clip",
    avatarId,
    folderId,
    data: clip.data,
    contentType: clip.contentType,
    width: clip.width,
    height: clip.height,
    durationSeconds: clip.durationSeconds,
    meta: {
      source: "upload",
      rightsConfirmedAt,
      originalName,
      original: { type: clip.originalType, bytes: clip.originalBytes },
      ...(requestId ? { requestId } : {}),
    },
  });

  return { ok: true, id: media.id, kind: "clip", width: clip.width, height: clip.height, durationSeconds: clip.durationSeconds };
}

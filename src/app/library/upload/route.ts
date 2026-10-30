import { requireOwnFolder } from "@/data/folders";
import { requireUser, type User } from "@/data/users";
import { currentAvatar } from "@/lib/current-avatar";
import { requireWithinLimit } from "@/lib/rate-limit";
import { bodyTooLargeMessage, REQUEST_BODY_LIMIT } from "@/lib/upload-handoff";
import { MAX_VIDEO_BYTES, megabytes, normaliseVideoType } from "@/lib/video-bytes";

import { MAX_BYTES, MIN_BYTES } from "../../onboarding/photos";
import { fail, RIGHTS_REQUIRED, rightsConfirmed, storeUpload, UPLOAD_LIMIT, uploadFailure } from "./store";

/* One file per request, in the body: a photo, or a clip small enough to post.
 *
 * The same shape as the onboarding upload route, and for the same reasons — a
 * server action's body is capped at 1MB, one request per file means a dropped
 * connection costs one file rather than the set, and the picker can show real
 * per-file progress.
 *
 * This is now the small-file path. Vercel refuses a request body over 4.5MB
 * before any of this runs, and a clip off a phone is three to six times that,
 * so the browser sends a clip straight to storage instead (`start/` issues the
 * URL, `finish/` stores the result). Photos still come this way: the browser
 * has shrunk them to a 2048px JPEG, which is well under the ceiling. What is
 * done with the bytes once they are here is in `store.ts`, shared with the
 * other path.
 */

export const dynamic = "force-dynamic";

/* Re-muxing a clip through ffmpeg is the slow case here, and it happens inside
   the request because the result is what decides whether the row is written
   at all. A minute is the ceiling the re-mux itself is bounded to. */
export const maxDuration = 120;

export async function POST(request: Request): Promise<Response> {
  // The proxy already refused anyone signed out; this is the check that counts.
  const user = await requireUser();
  try {
    return await upload(request, user);
  } catch (error) {
    return uploadFailure(error);
  }
}

async function upload(request: Request, user: User): Promise<Response> {
  /* In production the platform has already answered a 413 of its own, with no
     JSON in it, before this line. Locally nothing stops the body, so the same
     refusal is made here in words, and made before the body is read. */
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > REQUEST_BODY_LIMIT) return fail(413, bodyTooLargeMessage(declared));

  /* Decoding is the expensive part and it happens whether or not the file turns
     out to be usable, so the limit is taken before the body is read. */
  await requireWithinLimit(user, UPLOAD_LIMIT);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail(400, "No file was sent.");
  if (!rightsConfirmed(form?.get("rights"))) return fail(400, RIGHTS_REQUIRED);
  const rightsConfirmedAt = new Date().toISOString();

  /* Uploads hang off her primary avatar, so a photo she adds is eligible for
     the same things a generated one is: carousel picking and animation. An
     account with no avatar has not finished setup and has nowhere to put this. */
  const avatar = await currentAvatar(user.id);
  if (!avatar) return fail(409, "Finish setting up your avatar first, then you can add your own photos and clips.");

  const claimed = normaliseVideoType(file.type);
  const wantsVideo = claimed.startsWith("video/");

  /* The size check before the body is read is the client's framing, which is
     worth refusing on: reading 500MB to then refuse it is the attack. The
     length that actually arrived is checked again below. */
  const ceiling = wantsVideo ? MAX_VIDEO_BYTES : MAX_BYTES;
  if (file.size > ceiling) {
    return fail(
      413,
      wantsVideo
        ? `That clip is ${megabytes(file.size)}MB. ${MAX_VIDEO_BYTES / 1024 / 1024}MB is the most we can take.`
        : `That photo is bigger than ${MAX_BYTES / 1024 / 1024}MB. Try one straight from your camera roll.`,
    );
  }
  if (file.size < (wantsVideo ? 1 : MIN_BYTES)) {
    return fail(400, wantsVideo ? "That file is too small to be a video." : "That file is too small to be a photo.");
  }

  const raw = Buffer.from(await file.arrayBuffer());
  if (raw.byteLength > ceiling) return fail(413, "That file is bigger than it said it was.");

  // Uploads land in the folder that was open, like everything else made from that screen.
  const folderId = (await requireOwnFolder(user.id, form?.get("folder"))) ?? null;
  const originalName = file.name.slice(0, 120);
  const subject = form?.get("subject") === "scene" ? ("scene" as const) : undefined;
  return storeUpload({ user, avatarId: avatar.id, folderId, originalName, rightsConfirmedAt, subject }, raw, file.type);
}

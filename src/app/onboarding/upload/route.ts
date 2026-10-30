import { getAvatar } from "@/data/avatars";
import { deleteMedia, MediaLimitReachedError, saveMediaCapped } from "@/data/media";
import { flowStateFor } from "@/data/onboarding";
import { requireUser, type User } from "@/data/users";
import { EmailNotVerifiedError } from "@/lib/email-gate";
import { userMessage } from "@/lib/errors";
import { UploadRejectedError } from "@/lib/image-bytes";
import { reencodeToJpeg } from "@/lib/image-reencode";
import { RateLimitedError, requireWithinLimit } from "@/lib/rate-limit";
import { screenOnUpload } from "@/safety/gate";
import { SafetyRefusalError } from "@/safety/refusals";
import { withModelSpend } from "@/spend";

import { checkUpload, MAX_BYTES, MAX_PHOTOS } from "../photos";

/* One photo per request.
 *
 * A server action would be the obvious home for this, but its request body is
 * capped at 1MB and fifteen photos in one submission is megabytes whatever the
 * browser does to them first. A route handler has no such cap, and sending the
 * photos one at a time keeps every request small, lets the picker show real
 * per-photo progress, and means a dropped connection costs one photo rather
 * than the set.
 *
 * What is stored is never what was sent. The browser has already downscaled
 * each photo to a 2048px JPEG, and this assumes it did not: the bytes are
 * sniffed for a real JPEG, PNG or WebP header, the dimensions are read out of
 * that header and refused if they are absurd, and only then is the file
 * decoded — once, under an explicit format, with a pixel ceiling and a
 * timeout — and re-encoded. That JPEG is what lands in storage; the original
 * bytes are never written anywhere.
 */

export const dynamic = "force-dynamic";

function fail(status: number, message: string): Response {
  return Response.json({ ok: false, message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  // The proxy already refused anyone signed out; this is the check that counts.
  const user = await requireUser();
  try {
    return await upload(request, user);
  } catch (error) {
    if (error instanceof RateLimitedError) return fail(429, error.message);
    if (error instanceof EmailNotVerifiedError) return fail(403, error.message);
    if (error instanceof SafetyRefusalError) return fail(422, error.message);
    if (error instanceof UploadRejectedError) return fail(error.status, error.message);
    if (error instanceof MediaLimitReachedError) {
      return fail(409, `${MAX_PHOTOS} photos is the most we can use. Remove one first.`);
    }
    return fail(500, userMessage("onboarding upload", error));
  }
}

async function upload(request: Request, user: User): Promise<Response> {
  /* Decoding is the expensive part and it happens whether or not the file
     turns out to be a photo, so the limit is taken before the body is read. */
  await requireWithinLimit(user, "upload");

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail(400, "No photo was sent.");

  const { session, uploads } = await flowStateFor(user.id);
  const avatarId = session?.ui.avatarId ?? null;
  if (!session || !avatarId || !(await getAvatar(user.id, avatarId))) {
    return fail(409, "Setup has not started yet. Go back to the first screen.");
  }

  /* Consent, size and a first look at the count, all before a byte is read.
     The count here is a courtesy: the one that binds is the conditional insert
     below, because a count and a write are two round trips with a gap. */
  const verdict = checkUpload({
    contentType: file.type,
    bytes: file.size,
    existing: uploads.length,
    consented: Boolean(session.ui.consent),
  });
  if (!verdict.ok) return fail(verdict.status, verdict.message);

  const raw = Buffer.from(await file.arrayBuffer());
  // `file.size` is the client's framing; this is the length that actually arrived.
  if (raw.byteLength > MAX_BYTES) return fail(413, "That photo is bigger than 8MB.");

  const photo = await reencodeToJpeg(raw, { claimedType: file.type });

  const media = await saveMediaCapped(
    user.id,
    {
      kind: "upload",
      avatarId,
      data: photo.data,
      contentType: photo.contentType,
      width: photo.width,
      height: photo.height,
      meta: {
        /* What she agreed to, stored next to the bytes it covers rather than
           only on the avatar, so a photo can never be separated from its
           permission. */
        consent: session.ui.consent?.kind ?? null,
        consentAt: session.ui.consent?.at ?? null,
        originalName: file.name.slice(0, 120),
        /* The shape of what arrived, for the record. The bytes it describes are
           gone: this is a description, not a copy. */
        original: {
          type: photo.originalType,
          width: photo.originalWidth,
          height: photo.originalHeight,
          bytes: raw.byteLength,
        },
      },
    },
    MAX_PHOTOS,
  );

  /* Screened after the row exists, so the verdict has somewhere to live and a
     refused photo is deleted rather than left half-stored. The check is a
     model call, so it takes from the vision allowance and counts against the
     daily cap like any other. */
  const screened = await withModelSpend(user, { limit: "vision", shape: "screen_photo" }, () =>
    screenOnUpload(user.id, media.id, { mimeType: photo.contentType, data: photo.data }));
  if (!screened.ok) {
    await deleteMedia(user.id, media.id);
    return fail(422, screened.message);
  }

  const count = Math.min(uploads.length + 1, MAX_PHOTOS);
  return Response.json({
    ok: true,
    id: media.id,
    url: `/api/media/${media.id}`,
    count,
    remaining: MAX_PHOTOS - count,
  });
}

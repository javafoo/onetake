import type { InlineImage } from "@/ai/gemini";
import { getMedia, updateMediaMeta } from "@/data/media";

import { refuse, recordRefusal } from "./refusals";
import { refusal, type RefusalReason, type ScreenVerdict } from "./verdict";

/* The prompts are server-only, and a `server-only` import fails the moment its
   module is loaded — including by anything that merely imports this file on
   the way to something else. Loading it at the point of use keeps that marker
   meaningful without making every importer of the job machine a server
   module. */
async function screenPhoto(image: InlineImage): Promise<ScreenVerdict> {
  const { screenPhoto: check } = await import("./screen");
  return check(image);
}

/* Where the screening actually happens, and what a failed check means at each
 * point. The two answers are different on purpose.
 *
 * At upload: a check that cannot run lets the photo through and is recorded.
 * A provider outage must not stop somebody setting up their account, and
 * nothing has been generated yet — the photo is sitting in private storage
 * where only its owner can see it.
 *
 * Before generation: a check that cannot run refuses. This is the point where
 * we would be making something, and generating without the check is precisely
 * the thing the policy says we do not do. The message says so.
 *
 * The verdict is cached on the photo's own media row, so the check runs once
 * per photograph rather than once per generation. That is also what makes the
 * generation-time check cheap enough to be unconditional: the photos a
 * generation uses were screened when they arrived, and only a row that somehow
 * has no verdict costs a call.
 */

/** What a screened photo carries on its media row. */
export interface StoredVerdict {
  ok: boolean;
  reason?: string;
  at: string;
}

function stored(meta: unknown): StoredVerdict | null {
  const value = (meta as { safety?: StoredVerdict } | null)?.safety;
  return value && typeof value.ok === "boolean" ? value : null;
}

/**
 * Screen a photo as it arrives and remember the answer on its row.
 *
 * Returns the verdict rather than throwing, because the upload route wants to
 * refuse with its own status code. A check that could not run is recorded and
 * allowed; the generation path will insist on it later.
 */
export async function screenOnUpload(
  userId: string,
  mediaId: string,
  image: InlineImage,
): Promise<ScreenVerdict> {
  const verdict = await screenPhoto(image);

  if (!verdict.ok && verdict.reason === "check_failed") {
    await recordRefusal(userId, "upload", "check_failed");
    // Allowed through, unscreened, and marked as such.
    await updateMediaMeta(userId, mediaId, { safety: { ok: false, reason: "check_failed", at: new Date().toISOString() } });
    return { ok: true };
  }

  await updateMediaMeta(userId, mediaId, {
    safety: { ok: verdict.ok, ...(verdict.ok ? {} : { reason: verdict.reason }), at: new Date().toISOString() },
  });
  if (!verdict.ok) await recordRefusal(userId, "upload", verdict.reason);
  return verdict;
}

/**
 * Refuse unless every photograph about to be sent to the image model has been
 * screened and passed.
 *
 * Fails closed: an unscreened row is screened now, and a check that cannot run
 * stops the generation.
 */
export async function requireScreenedPhotos(
  userId: string,
  photos: { mediaId: string; image: InlineImage }[],
): Promise<void> {
  for (const photo of photos) {
    const row = await getMedia(userId, photo.mediaId);
    const known = stored(row?.meta);

    if (known?.ok === true) continue;
    if (known && known.reason && known.reason !== "check_failed") {
      await refuse(userId, "generation", refusal(known.reason as RefusalReason));
    }

    const verdict = await screenPhoto(photo.image);
    await updateMediaMeta(userId, photo.mediaId, {
      safety: { ok: verdict.ok, ...(verdict.ok ? {} : { reason: verdict.reason }), at: new Date().toISOString() },
    });
    if (!verdict.ok) await refuse(userId, "generation", verdict);
  }
}

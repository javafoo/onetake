import type { ReelSummary } from "@/components/reels/reel-card";
import type { Draft } from "@/data/drafts";
import { mediaUrl, type Media } from "@/data/media";

import { isFavorite } from "./tile-actions";

/**
 * Her finished reels: each reel draft joined to the reel it produced, newest
 * reel first. A draft whose reel is not among `reels` (deleted, or on another
 * avatar) is left out, and so is a carousel. Pure, so the Reels page and any
 * other reader of the same list cannot disagree about what counts as finished.
 */
export function reelSummaries(
  drafts: readonly Draft[],
  reels: readonly Media[],
  folderNames: ReadonlyMap<string, string> = new Map(),
): ReelSummary[] {
  const byMedia = new Map(reels.map((row) => [row.id, row]));
  return drafts
    .flatMap((draft) => {
      const media = draft.format === "reel" && draft.outputMediaId ? byMedia.get(draft.outputMediaId) : undefined;
      if (!media) return [];
      return [{
        draftId: draft.id,
        mediaId: media.id,
        clipMediaId: draft.clipMediaId,
        src: mediaUrl(media.id),
        hook: draft.hook,
        angle: draft.angle,
        captionBody: draft.caption,
        cta: draft.cta,
        caption: `${draft.caption}\n\n${draft.cta}`.trim(),
        seconds: media.durationSeconds == null ? null : Number(media.durationSeconds),
        stale: draft.status === "draft",
        createdAt: media.createdAt.toISOString(),
        folderName: media.folderId ? folderNames.get(media.folderId) ?? null : null,
        favorite: isFavorite(media.meta),
      }];
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

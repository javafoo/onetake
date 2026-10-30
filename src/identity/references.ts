import { toReference, type InlineImage } from "@/ai/gemini";
import { referenceMediaIds } from "@/data/avatars";
import { withLocalFile } from "@/data/media";

/* What stands in for a trained character model: the photos attached to every
   later generation. The order is what src/data/avatars.ts decided — originals
   first, because the first reference sets the look — and the bytes come out of
   private storage into a temp file, because the downscaler is ffmpeg. */

export const MAX_CHARACTER_REFS = 5; // Nano Banana Pro's documented character-reference limit

/** A reference plus the row it came from, so a safety verdict can be cached on it. */
export type Reference = { mediaId: string; image: InlineImage };

export async function referencesFor(userId: string, avatarId: string): Promise<Reference[]> {
  const ids = await referenceMediaIds(userId, avatarId, MAX_CHARACTER_REFS);
  const references: Reference[] = [];
  for (const id of ids) {
    references.push({ mediaId: id, image: await withLocalFile(userId, id, (path) => toReference(path)) });
  }
  return references;
}

export async function referenceImages(userId: string, avatarId: string): Promise<InlineImage[]> {
  return (await referencesFor(userId, avatarId)).map((reference) => reference.image);
}

/* The three corner buttons on a library tile: download, favorite, delete.
   Pure and client-safe: the tiles and the server actions share these rules.

   A favorite is a flag in a json column that already exists, never a column of
   its own: `media.meta.favorite` for a photo, a clip or a reel, and
   `drafts.spec.favorite` for a carousel or story set (a set is a draft, and its
   slides are redrawn as new rows, so the flag cannot live on a slide). Only
   `true` counts; anything else is "not a favorite". */

export type TileNoun = "photo" | "clip" | "reel" | "set";

/** True when a meta or spec object carries the favorite flag. */
export function isFavorite(meta: unknown): boolean {
  return typeof meta === "object" && meta !== null && (meta as { favorite?: unknown }).favorite === true;
}

/**
 * What a remade row takes over from the row it replaces. A rebuilt reel and a
 * redrawn set are new rows with new ids; without this, rebuilding a favorite
 * would quietly unfavorite it.
 */
export function carriedFavorite(previous: unknown): { favorite: true } | Record<string, never> {
  return isFavorite(previous) ? { favorite: true } : {};
}

/** The button's name, which says what pressing it will do. */
export function favoriteLabel(on: boolean): string {
  return on ? "Remove from favorites" : "Add to favorites";
}

/** The inline question before a delete: what goes, and what stays. */
export function deleteQuestion(noun: TileNoun): { question: string; note: string } {
  switch (noun) {
    case "photo":
      return { question: "Delete this photo?", note: "It cannot be brought back." };
    case "clip":
      return { question: "Delete this clip?", note: "Reels made from it are kept." };
    case "reel":
      return { question: "Delete this reel?", note: "Its hook goes back to Hooks." };
    case "set":
      return { question: "Delete this set?", note: "All its slides go with it." };
  }
}

/** Keeps only the favorites, or everything when `only` is false. */
export function favoritesOnly<T extends { favorite?: boolean }>(items: T[], only: boolean): T[] {
  return only ? items.filter((item) => item.favorite === true) : items;
}

/* --- the Favorites tab --------------------------------------------------- */

export type FavoriteSection = "photos" | "clips" | "reels" | "sets";

const SECTION_ORDER: FavoriteSection[] = ["photos", "clips", "reels", "sets"];

export const FAVORITE_SECTION_LABEL: Record<FavoriteSection, string> = {
  photos: "Photos",
  clips: "Clips",
  reels: "Reels",
  sets: "Carousels",
};

export const FAVORITES_EMPTY = {
  title: "Nothing in Favorites yet",
  body: "Tap the heart on any photo, clip, reel or set to keep it here.",
};

/** The sections the tab draws, in library order, leaving out any with nothing hearted. */
export function favoriteSections(counts: Record<FavoriteSection, number>): { id: FavoriteSection; label: string; count: number }[] {
  return SECTION_ORDER.filter((id) => counts[id] > 0).map((id) => ({ id, label: FAVORITE_SECTION_LABEL[id], count: counts[id] }));
}

/** Everything hearted, for the count on the tab. */
export function favoriteTotal(counts: Record<FavoriteSection, number>): number {
  return SECTION_ORDER.reduce((sum, id) => sum + counts[id], 0);
}

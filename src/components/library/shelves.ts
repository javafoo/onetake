/* The Photos tab's three shelves. Shared by the server page and the client
   components, so it holds no React and no database.

   The main grid, and every folder, is the photos the app made: those are what
   she posts and what the generators build on. Two kinds of photo are kept off
   it, on shelves of their own that fill themselves:

   - "Your uploads": what she added from her phone, of herself or of places and
     things. Hers, but not the app's work, and not what the grid is for.
   - "Quotes": photos with words already drawn on them. They are finished
     posts, and a photo that already carries words cannot take new ones, so no
     set or clip should start from one.

   A shelf is worked out from the photo itself every time, never stored: a new
   photo is on the right shelf the moment it exists, and nothing has to be
   moved. */

export type PhotoShelf = "made" | "uploads" | "words";

/** The shelves she can open, in the order the folder row shows them. The main grid is not one of them. */
export const SHELVES = ["uploads", "words"] as const;
export type OpenShelf = (typeof SHELVES)[number];

export const SHELF_LABEL: Record<OpenShelf, { name: string; empty: string }> = {
  uploads: {
    name: "Your uploads",
    empty: "Photos you add with “Add your own” land here, of you or of places and things.",
  },
  words: {
    name: "Quotes",
    empty: "Photos with words drawn on them land here by themselves. They are kept out of new carousels and clips, since they already carry words.",
  },
};

/** Which shelf a photo is on. Words win: words drawn on an upload make a finished post, not an upload. */
export function photoShelf(meta: unknown): PhotoShelf {
  const value = (meta ?? {}) as { words?: unknown; source?: unknown };
  if (value.words) return "words";
  if (value.source === "upload") return "uploads";
  return "made";
}

/** The shelf a URL asked for, or null for the main grid. Anything unknown is the main grid. */
export function shelfFrom(value: unknown): OpenShelf | null {
  return SHELVES.find((shelf) => shelf === value) ?? null;
}

type Shelved = { meta: unknown; folderId: string | null };

/**
 * The photos one view shows. An open shelf shows every photo on it, whatever
 * folder it is filed in; otherwise the made photos, narrowed to the folder
 * (a folder id, null for unfiled, undefined for all).
 */
export function photosFor<T extends Shelved>(rows: T[], view: { shelf: OpenShelf | null; folder: string | null | undefined }): T[] {
  if (view.shelf) return rows.filter((row) => photoShelf(row.meta) === view.shelf);
  return rows.filter((row) => {
    if (photoShelf(row.meta) !== "made") return false;
    if (view.folder === undefined) return true;
    return view.folder === null ? row.folderId === null : row.folderId === view.folder;
  });
}

/** Counts for the folder row, from the same rows the grid shows, so a chip never says 3 and shows two. */
export function shelfCounts(rows: Shelved[]): { made: number; uploads: number; words: number; byFolder: Record<string, number>; unfiled: number } {
  const counts = { made: 0, uploads: 0, words: 0, byFolder: {} as Record<string, number>, unfiled: 0 };
  for (const row of rows) {
    const shelf = photoShelf(row.meta);
    counts[shelf] += 1;
    if (shelf !== "made") continue;
    if (row.folderId === null) counts.unfiled += 1;
    else counts.byFolder[row.folderId] = (counts.byFolder[row.folderId] ?? 0) + 1;
  }
  return counts;
}

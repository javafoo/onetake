import { kitOwnerSlug } from "@/carousel/owners";
import { SetTile } from "@/components/carousel/set-tile";
import { Gallery } from "@/components/library/gallery";
import { toGalleryItem } from "@/components/library/library-view";
import { LibraryTabs } from "@/components/library/tabs";
import { ReelTile, type ReelTileItem } from "@/components/reels/reel-tile";
import { EmptyState, PageHeader } from "@/components/ui";
import { draftsWithPendingJob, listCarousels } from "@/data/carousels";
import { getDraftsByIds } from "@/data/drafts";
import { listFolders } from "@/data/folders";
import { listMedia, mediaUrl, SHOW_ALL } from "@/data/media";
import { requireUser } from "@/data/users";
import { currentAvatar } from "@/lib/current-avatar";
import { FAVORITES_EMPTY, favoriteSections, favoriteTotal, type FavoriteSection } from "@/lib/tile-actions";

export const dynamic = "force-dynamic";

/* Everything she has hearted, in one place: photos, clips, reels and sets.
 *
 * Each kind is asked for its hearted rows only, in SQL, scoped to her account
 * and to the avatar the rest of the library shows. The tiles are the ones
 * every other tab draws, so taking the heart off or deleting from here works
 * the same, and the item leaves this page when it does. */

export default async function LibraryFavoritesPage() {
  const user = await requireUser();
  const avatar = await currentAvatar(user.id);
  const scope = { avatarId: avatar?.id, orUnassigned: true, keptOnly: true, favoritesOnly: true, limit: SHOW_ALL } as const;

  const [photos, clips, reelRows, sets, working, folders] = await Promise.all([
    listMedia(user.id, "image", scope),
    listMedia(user.id, "clip", scope),
    listMedia(user.id, "reel", scope),
    listCarousels(user.id, { avatarId: avatar?.id, favoritesOnly: true }),
    draftsWithPendingJob(user.id),
    listFolders(user.id),
  ]);

  const draftIdOf = (meta: unknown) => {
    const value = (meta as { draftId?: unknown } | null)?.draftId;
    return typeof value === "string" ? value : null;
  };
  const drafts = new Map(
    (await getDraftsByIds(user.id, reelRows.map((row) => draftIdOf(row.meta)).filter((id): id is string => id !== null))).map((draft) => [draft.id, draft]),
  );
  const reels: ReelTileItem[] = reelRows.map((row) => {
    const draftId = draftIdOf(row.meta);
    const draft = draftId ? drafts.get(draftId) : undefined;
    return { mediaId: row.id, draftId: draft?.id ?? null, src: mediaUrl(row.id), hook: draft?.hook ?? "", favorite: true };
  });

  const counts: Record<FavoriteSection, number> = { photos: photos.length, clips: clips.length, reels: reels.length, sets: sets.length };
  const sections = favoriteSections(counts);
  const folderList = folders.map(({ id, name }) => ({ id, name }));
  const slug = kitOwnerSlug(user.id);

  return (
    <>
      <PageHeader eyebrow="Library" title="Favorites" />

      <LibraryTabs tab="favorites" counts={{ favorites: favoriteTotal(counts) }} />

      {sections.length === 0 ? (
        <EmptyState title={FAVORITES_EMPTY.title}>{FAVORITES_EMPTY.body}</EmptyState>
      ) : (
        <div className="space-y-10">
          {sections.map((section) => (
            <section key={section.id} aria-labelledby={`favorites-${section.id}`}>
              <h2 id={`favorites-${section.id}`} className="mb-3 font-display text-xl text-ink">
                {section.label} <span className="text-base text-muted tabular-nums">{section.count}</span>
              </h2>
              {section.id === "photos" && <Gallery items={photos.map(toGalleryItem)} folders={folderList} kind="image" />}
              {section.id === "clips" && <Gallery items={clips.map(toGalleryItem)} folders={folderList} kind="clip" />}
              {section.id === "reels" && (
                <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3 lg:grid-cols-5 xl:grid-cols-6">
                  {reels.map((reel) => (
                    <ReelTile key={reel.mediaId} reel={reel} />
                  ))}
                </ul>
              )}
              {section.id === "sets" && (
                <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {sets.map((set) => (
                    <SetTile key={set.draft.id} set={set} busy={working.has(set.draft.id)} slug={slug} />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}

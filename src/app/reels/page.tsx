import Link from "next/link";

import { assembleAction, editDraftAction } from "@/app/actions";
import { LibraryTabs } from "@/components/library/tabs";
import { ReelCard, type ClipOption, type ReelSummary } from "@/components/reels/reel-card";
import { buttonClass, EmptyState, PageHeader } from "@/components/ui";
import { MAX_CAPTION_CHARS } from "@/content/draft-edit";
import { MAX_HOOK_WORDS } from "@/content/hooks";
import { keywordsOf } from "@/content/offers";
import { getProfile } from "@/data/brand";
import { listDrafts } from "@/data/drafts";
import { listFolders } from "@/data/folders";
import { listMedia, mediaUrl } from "@/data/media";
import { requireUser } from "@/data/users";
import { currentAvatar } from "@/lib/current-avatar";
import { reelSummaries } from "@/lib/reel-summaries";
import { favoritesOnly } from "@/lib/tile-actions";

export const dynamic = "force-dynamic";

type Filter = "all" | "favorites";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "favorites", label: "Favorites" },
];

const CHIP = "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors";
const CHIP_ON = "border-ink bg-ink text-canvas";
const CHIP_OFF = "border-line-strong bg-surface text-ink-soft hover:border-ink hover:text-ink";

/* Every finished reel in one place, a tab of the Library. Create is where a
   reel is made; this is where the finished ones are found again, downloaded,
   captioned, edited and rebuilt on another clip. */

/* Rebuilding a reel runs its job after the response, inside this route's time limit. */
export const maxDuration = 300;
export default async function ReelsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const raw = Array.isArray(params.show) ? params.show[0] : params.show;
  const filter: Filter = raw === "favorites" ? raw : "all";

  const user = await requireUser();
  const avatar = await currentAvatar(user.id);
  const [drafts, reelRows, clipRows, folders, profile] = await Promise.all([
    listDrafts(user.id, { avatarId: avatar?.id }),
    listMedia(user.id, "reel", { avatarId: avatar?.id, orUnassigned: true }),
    listMedia(user.id, "clip", { avatarId: avatar?.id, orUnassigned: true, keptOnly: true }),
    listFolders(user.id),
    getProfile(user.id, avatar?.id ?? null),
  ]);
  const clips: ClipOption[] = clipRows.map((clip) => ({ id: clip.id, src: mediaUrl(clip.id) }));
  const folderName = new Map(folders.map((folder) => [folder.id, folder.name]));
  const reels: ReelSummary[] = reelSummaries(drafts, reelRows, folderName);

  const counts: Record<Filter, number> = {
    all: reels.length,
    favorites: favoritesOnly(reels, true).length,
  };
  const shown = filter === "favorites" ? favoritesOnly(reels, true) : reels;

  return (
    <>
      <PageHeader
        eyebrow="Library"
        title="Finished reels"
      >
        <Link href="/create" className={buttonClass(reels.length ? "quiet" : "primary")}>
          {reels.length ? "Make another on Create" : "Make your first reel"}
        </Link>
      </PageHeader>

      <LibraryTabs tab="reels" counts={{ reels: reels.length }} />

      {reels.length > 0 && (
        <nav aria-label="Which reels" className="mb-6 flex flex-wrap gap-2">
          {FILTERS.map((item) => {
            const active = item.id === filter;
            return (
              <Link
                key={item.id}
                href={item.id === "all" ? "/reels" : `/reels?show=${item.id}`}
                aria-current={active ? "page" : undefined}
                className={`${CHIP} ${active ? CHIP_ON : CHIP_OFF}`}
              >
                {item.label}
                <span className={`text-xs tabular-nums ${active ? "text-canvas/70" : "text-muted"}`}>{counts[item.id]}</span>
              </Link>
            );
          })}
        </nav>
      )}

      {shown.length === 0 ? (
        <EmptyState
          title={reels.length === 0 ? "No reels yet" : "No favorites yet"}
          action={
            reels.length === 0 ? (
              <Link href="/create" className={buttonClass("primary")}>
                Open Create
              </Link>
            ) : filter === "favorites" ? (
              <Link href="/reels" className={buttonClass("quiet")}>
                See all reels
              </Link>
            ) : undefined
          }
        >
          {reels.length === 0
            ? "On Create, ask for a reel, or attach a clip with + and type the words. The finished reel lands here."
            : "Tap the heart on a reel's preview to keep it here."}
        </EmptyState>
      ) : (
        <ul className="space-y-4">
          {shown.map((reel) => (
            <ReelCard
              key={reel.draftId}
              reel={reel}
              edit={editDraftAction}
              assemble={assembleAction}
              clips={clips}
              keywords={keywordsOf(profile)}
              maxHookWords={MAX_HOOK_WORDS}
              maxCaptionChars={MAX_CAPTION_CHARS}
            />
          ))}
        </ul>
      )}
    </>
  );
}

import Link from "next/link";

import { kitName } from "@/carousel/kits";
import { TileActions } from "@/components/library/tile-actions";
import { Badge, MediaTile } from "@/components/ui";
import type { CarouselSummary } from "@/data/carousels";
import { mediaUrl } from "@/data/media";

/* One set as a tile: its cover, its hook, where it stands, and the corner
   buttons. Drawn by /carousels and by the Favorites tab, so a set looks and
   behaves the same wherever it is found. */

export function SetTile({
  set: { draft, kitId, slideCount, coverMediaId, favorite },
  busy,
  slug,
}: {
  set: CarouselSummary;
  /** A job is still writing or drawing it. */
  busy: boolean;
  /** The account's kit owner slug, for the kit's name; most accounts have none. */
  slug: string | undefined;
}) {
  return (
    <li className="group relative">
      <Link
        href={`/carousels/${draft.id}`}
        className="group block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {/* Every tile is 4:5, whatever the set is: a row of thumbnails
            that jumps between two shapes reads as a broken grid, and
            the badge underneath already says which format this is. */}
        {coverMediaId ? (
          <MediaTile
            kind="image"
            src={mediaUrl(coverMediaId)}
            alt={`Cover slide of ${draft.hook}`}
            ratio="4:5"
            className="transition-opacity group-hover:opacity-90"
          />
        ) : (
          <div className="grid aspect-[4/5] w-full place-items-center rounded-lg border border-dashed border-line-strong bg-surface p-4 text-center text-xs text-muted">
            {busy ? "Being written and drawn…" : "This set has no slides"}
          </div>
        )}
        <p className="mt-2.5 line-clamp-2 text-sm font-medium text-balance text-ink group-hover:text-accent">
          {draft.hook}
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={busy ? "accent" : "plain"}>
            {busy ? "Making" : "Ready"}
          </Badge>
          <span className="text-xs text-muted">
            {[
              draft.format === "story" ? "Story" : "Carousel",
              kitId ? (kitName(kitId, slug) ?? kitId) : null,
              slideCount > 0 ? `${slideCount} slides` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </p>
      </Link>
      {/* Beside the link, not in it: a button inside a link is not a button.
          Download and delete wait until the set is finished. */}
      <TileActions
        target={{ type: "set", id: draft.id }}
        noun="set"
        favorite={favorite}
        download={!busy && slideCount > 0 ? `/carousels/${draft.id}/zip` : undefined}
        canDelete={!busy}
      />
    </li>
  );
}

import Link from "next/link";

import { TileActions } from "@/components/library/tile-actions";
import { downloadHref } from "@/lib/download";

/* A finished reel as a small tile, for the Favorites tab: it plays in place,
   carries the corner buttons, and links to its full card on /reels, where
   the words, the caption and the date are edited. */

export type ReelTileItem = {
  mediaId: string;
  /** The draft it was made from, for the link to its card. Null if the draft is gone. */
  draftId: string | null;
  src: string;
  hook: string;
  favorite: boolean;
};

export function ReelTile({ reel }: { reel: ReelTileItem }) {
  return (
    <li>
      <div className="group relative">
        {/* #t seeks to a frame so the poster is the reel, not a black box. */}
        <video
          src={`${reel.src}#t=0.1`}
          controls
          loop
          muted
          playsInline
          preload="metadata"
          className="aspect-[9/16] w-full rounded-lg border border-line bg-black"
        />
        <TileActions target={{ type: "media", id: reel.mediaId }} noun="reel" favorite={reel.favorite} download={downloadHref(reel.mediaId)} />
      </div>
      {reel.hook && <p className="mt-2 line-clamp-2 text-sm text-ink">{reel.hook}</p>}
      <Link
        href={reel.draftId ? `/reels#reel-${reel.draftId}` : "/reels"}
        className="mt-1 inline-block text-xs font-medium text-accent underline-offset-4 hover:underline"
      >
        Edit or plan on Reels
      </Link>
    </li>
  );
}

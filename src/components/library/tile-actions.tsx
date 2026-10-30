"use client";

import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";

import { deleteSetAction, setSetFavoriteAction } from "@/app/carousels/actions";
import { deleteMediaAction, setFavoriteAction } from "@/app/library/actions";
import { DownloadIcon, HeartIcon, TrashIcon } from "@/components/ui/icons";
import { deleteQuestion, favoriteLabel, type TileNoun } from "@/lib/tile-actions";

/* The corner buttons on a library tile: download, favorite, delete.
 *
 * Like the download corner before it, the buttons show on hover or focus
 * with a mouse, and are always there on a touch screen, which has no hover.
 * A heart that is on stays showing either way, so favorites can be picked out
 * of a grid at a glance.
 *
 * The parent needs `relative` and `group`, and these sit beside the tile's own
 * button or link rather than inside it: a button inside a button is not a
 * button. The delete question covers the parent, so it is the tile itself
 * that asks. Nothing here spends a credit. */

/** A photo, clip or reel is a media row; a carousel or story set is a draft. */
export type TileTarget = { type: "media"; id: string } | { type: "set"; id: string };

const CORNER =
  "grid size-8 place-items-center rounded-full bg-black/55 text-white transition-opacity hover:bg-black/75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait";
const ON_HOVER =
  "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100";

export function TileActions({
  target,
  noun,
  favorite,
  download,
  canDelete = true,
}: {
  target: TileTarget;
  /** What the tile is, in the words the delete question uses. */
  noun: TileNoun;
  favorite: boolean;
  /** Where Download saves from; left out, there is no Download button. */
  download?: string;
  /** Off while the thing is still being made. */
  canDelete?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [shownFavorite, showFavorite] = useOptimistic(favorite);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const keep = useRef<HTMLButtonElement>(null);

  /* The trash button is gone once the question is up, so focus would fall to
     the page. It lands on "No", the answer that changes nothing. */
  useEffect(() => {
    if (confirming) keep.current?.focus();
  }, [confirming]);

  useEffect(() => {
    if (!problem) return;
    const timer = setTimeout(() => setProblem(null), 4000);
    return () => clearTimeout(timer);
  }, [problem]);

  function toggleFavorite() {
    const next = !shownFavorite;
    start(async () => {
      // Shown at once; if the server says no, the heart goes back when the transition ends.
      showFavorite(next);
      const result = target.type === "media" ? await setFavoriteAction(target.id, next) : await setSetFavoriteAction(target.id, next);
      if (!result.ok) setProblem(result.message);
    });
  }

  function remove() {
    start(async () => {
      const result = target.type === "media" ? await deleteMediaAction([target.id]) : await deleteSetAction(target.id);
      setConfirming(false);
      if (result.ok) router.refresh();
      else setProblem(result.message);
    });
  }

  const words = deleteQuestion(noun);

  return (
    <>
      {!confirming && (
        <div className="absolute top-1.5 right-1.5 z-10 flex flex-col gap-1.5">
          {download && (
            <a href={download} download aria-label={`Download this ${noun}`} title="Download" className={`${CORNER} ${ON_HOVER}`}>
              <DownloadIcon className="size-4" />
            </a>
          )}
          <button
            type="button"
            onClick={toggleFavorite}
            aria-pressed={shownFavorite}
            aria-label={favoriteLabel(shownFavorite)}
            title={favoriteLabel(shownFavorite)}
            className={`${CORNER} ${shownFavorite ? "" : ON_HOVER}`}
          >
            <HeartIcon filled={shownFavorite} className="size-4" />
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              aria-label={`Delete this ${noun}`}
              title="Delete"
              className={`${CORNER} ${ON_HOVER}`}
            >
              <TrashIcon className="size-4" />
            </button>
          )}
        </div>
      )}

      {confirming && (
        <div
          role="group"
          aria-label={words.question}
          onKeyDown={(event) => {
            if (event.key === "Escape") setConfirming(false);
          }}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-lg bg-black/75 p-2 text-center text-white"
        >
          <p className="text-xs leading-snug font-semibold">{words.question}</p>
          <p className="text-2xs leading-snug text-white/80">{words.note}</p>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="min-h-8 rounded-md bg-white px-3 text-xs font-semibold text-accent hover:bg-white/90 disabled:cursor-wait disabled:opacity-60"
            >
              {pending ? "Deleting…" : "Yes"}
            </button>
            <button
              ref={keep}
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="min-h-8 rounded-md border border-white/60 px-3 text-xs font-medium text-white hover:bg-white/15"
            >
              No
            </button>
          </div>
        </div>
      )}

      {problem && (
        <p role="alert" className="absolute inset-x-1.5 bottom-1.5 z-20 rounded-md bg-black/80 px-2 py-1.5 text-2xs leading-snug text-white">
          {problem}
        </p>
      )}
    </>
  );
}

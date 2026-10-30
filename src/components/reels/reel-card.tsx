"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteMediaAction } from "@/app/library/actions";
import type { ActionState } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { Badge, Button, buttonClass, Card, MediaChoice } from "@/components/ui";
import { DownloadIcon, TrashIcon } from "@/components/ui/icons";
import { ResultMessage } from "@/components/ui/message";
import { TileActions } from "@/components/library/tile-actions";
import { downloadHref } from "@/lib/download";

import { DraftEditor } from "./draft-editor";

/* One finished reel: the file, the hook it carries, and everything she does
   with it next — download, copy the caption, edit the words, rebuild it on
   another clip, or delete it. The file is what is deleted; the
   hook goes back to Hooks, so a reel she regrets costs nothing to redo. */

export type ReelSummary = {
  draftId: string;
  mediaId: string;
  /** The clip it was printed on, preselected when it is rebuilt. */
  clipMediaId: string | null;
  src: string;
  hook: string;
  angle: string;
  /** The caption body and the call to action, apart, for the editor. */
  captionBody: string;
  cta: string;
  caption: string;
  seconds: number | null;
  /** The draft was edited after this reel was made: it shows the old hook. */
  stale: boolean;
  createdAt: string;
  folderName: string | null;
  /** Hearted, from the reel's `meta.favorite`. */
  favorite: boolean;
};

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

export type ClipOption = { id: string; src: string };

export function ReelCard({
  reel,
  edit,
  assemble,
  clips,
  keywords,
  maxHookWords,
  maxCaptionChars,
}: {
  reel: ReelSummary;
  /** `editDraftAction`: the hook, caption and call to action. */
  edit: Action;
  /** `assembleAction`: prints the hook again, on the clip picked here. Free. */
  assemble: Action;
  clips: ClipOption[];
  keywords: string[];
  maxHookWords: number;
  maxCaptionChars: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  function remove() {
    start(async () => {
      const result = await deleteMediaAction([reel.mediaId]);
      if (result.ok) router.refresh();
      else setNote(result.message);
      setConfirm(false);
    });
  }

  return (
    <Card as="li" className="flex flex-col p-4 sm:flex-row sm:gap-5 sm:p-5" id={`reel-${reel.draftId}`}>
      <div className="group relative w-32 shrink-0 self-start sm:w-36">
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
        {/* Top right, clear of the player's own controls along the bottom. */}
        <TileActions target={{ type: "media", id: reel.mediaId }} noun="reel" favorite={reel.favorite} download={downloadHref(reel.mediaId)} />
      </div>
      <div className="mt-4 flex min-w-0 flex-1 flex-col gap-4 sm:mt-0">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Badge tone={reel.stale ? "warn" : "plain"}>
              {reel.stale ? "Hook changed — re-assemble" : "Ready to post"}
            </Badge>
            {reel.folderName && <span className="text-xs text-muted">{reel.folderName}</span>}
            {reel.seconds && <span className="text-xs text-muted">{Math.round(reel.seconds)}s</span>}
          </div>
          <DraftEditor
            draft={{ id: reel.draftId, hook: reel.hook, caption: reel.captionBody, cta: reel.cta }}
            action={edit}
            maxHookWords={maxHookWords}
            maxCaptionChars={maxCaptionChars}
            keywords={keywords}
          >
            {reel.angle && <p className="mt-1 text-xs text-muted">{reel.angle}</p>}
          </DraftEditor>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a href={reel.src} download={`reel-${reel.draftId.slice(0, 8)}.mp4`} className={buttonClass("primary", "sm")}>
            <DownloadIcon className="size-4" />
            Download
          </a>
          <CopyButton text={reel.caption} label="Copy caption" />
          {!rebuilding && clips.length > 0 && (
            <Button variant={reel.stale ? "primary" : "quiet"} size="sm" onClick={() => setRebuilding(true)}>
              {reel.stale ? "Re-assemble" : "Rebuild on another clip"}
            </Button>
          )}
          {/* The same words on another clip as a new reel, this one untouched: Create, with the hook pinned. */}
          <Link href={`/create?${new URLSearchParams({ hook: reel.hook, tab: "video" })}`} className={buttonClass("ghost", "sm")}>
            Use the hook again
          </Link>
        </div>

        {rebuilding && (
          <ActionForm
            action={assemble}
            submitLabel={reel.stale ? "Re-assemble the reel" : "Rebuild the reel"}
            pendingLabel="Rendering…"
            hint="Free. Under a minute. This reel is replaced."
            className="rounded-lg border border-line bg-sunken/40 p-3"
            secondary={
              <Button variant="ghost" size="sm" onClick={() => setRebuilding(false)}>
                Cancel
              </Button>
            }
          >
            <input type="hidden" name="id" value={reel.draftId} />
            <fieldset>
              <legend className="mb-2 text-xs font-medium text-muted">Pick the clip · {clips.length} in your library</legend>
              {/* Capped and scrolled: a long shelf must not push the rest of the card off a phone screen. */}
              <ul className="mb-3 grid max-h-56 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6 lg:max-h-72">
                {clips.map((clip, index) => (
                  <li key={clip.id}>
                    <MediaChoice name="clip" value={clip.id} kind="video" src={clip.src} ratio="9:16" label={`Clip ${index + 1}`} defaultChecked={clip.id === reel.clipMediaId} required />
                  </li>
                ))}
              </ul>
            </fieldset>
          </ActionForm>
        )}

        <div className="mt-auto border-t border-line pt-3">
          {confirm ? (
            <div className="flex flex-wrap items-center gap-3 text-sm text-ink-soft">
              <span>Delete this reel? Its hook goes back to Hooks, so you can put it on another clip later.</span>
              <Button variant="danger" size="sm" disabled={pending} onClick={remove}>
                {pending ? "Deleting…" : "Delete reel"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>
                Keep it
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirm(true)} className="text-muted">
              <TrashIcon className="size-4" />
              Delete reel
            </Button>
          )}
          {note && (
            <div className="mt-2">
              <ResultMessage ok={false}>{note}</ResultMessage>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

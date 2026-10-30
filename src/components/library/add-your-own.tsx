"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { PhotoSubject } from "@/carousel/match";
import { buttonClass } from "@/components/ui/button";
import { ResultMessage } from "@/components/ui/message";

import { isVideoFile, MAX_VIDEO_BYTES, SMALL_CLIP_MB, tooBig, UPLOAD_ACCEPT, uploadClip, uploadPhoto, type UploadReply } from "./upload-client";

/* "Add your own": photos and short clips off her own phone.
 *
 * Photos are downscaled in the browser before they leave it, exactly as the
 * onboarding picker does — a phone photo is five to twelve megabytes and the
 * app never needs more than 2048px, which is the difference between a set that
 * uploads on a train and one that does not.
 *
 * Clips are sent as they are, but not to us: our host refuses any request
 * body over 4.5MB before our code sees it, and a phone clip is several times
 * that. So a clip goes in three steps — ask the server for a signed URL
 * (`/library/upload/start`), PUT the file straight into storage, then ask the
 * server to check and keep it (`/library/upload/finish`). When the server has
 * no signer (a local run), or the PUT cannot be made from this browser, a clip
 * small enough to post goes the old way and a larger one is refused with a
 * sentence that says so. Re-encoding video in a browser means WebCodecs and
 * several hundred lines; the server re-muxes anyway.
 *
 * One file at a time, in the order she picked them, so a dropped connection
 * costs one file and the progress line is real rather than decorative.
 */

type Item = {
  key: string;
  name: string;
  state: "waiting" | "shrinking" | "uploading" | "checking" | "done" | "failed";
  message?: string;
  kind: "photo" | "clip";
  /** True once the clip is going straight to storage, so "Uploading…" and "Checking…" can be told apart. */
  direct?: boolean;
};

const SUBJECT_CHOICES: { value: PhotoSubject; name: string; line: string }[] = [
  { value: "me", name: "Me", line: "Photos of you. Used anywhere a photo of you goes." },
  {
    value: "scene",
    name: "Places and things",
    line: "A desk, a coffee, a view, with no face needed. Used in half-and-half and four-photo carousels.",
  },
];

export function AddYourOwn({
  remaining,
  folder,
  folderName,
  directUploads = false,
}: {
  remaining: number;
  /** The folder that is open; uploads are filed there. */
  folder?: string;
  folderName?: string;
  /** Whether the server can sign a direct upload; decides which clip limit the page promises. */
  directUploads?: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  /* Asked on every visit rather than remembered: the confirmation is about the
     files being picked now, and the server refuses an upload without it. */
  const [rights, setRights] = useState(false);
  /* Photos of her go everywhere a photo can; places and things are kept for
     the carousel layouts that put a line over a picture. */
  const [subject, setSubject] = useState<PhotoSubject>("me");

  const mark = (key: string, patch: Partial<Item>) =>
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  /** A clip, through the shared helper; the stages it reports are what the list shows. */
  function sendClip(item: Item, file: File): Promise<UploadReply | null> {
    return uploadClip(file, folder, (stage) => {
      if (stage === "uploading") mark(item.key, { state: "uploading" });
      else if (stage === "direct") mark(item.key, { direct: true });
      else if (stage === "checking") mark(item.key, { state: "checking" });
      else mark(item.key, { direct: false });
    });
  }

  async function add(files: FileList | null) {
    if (!files?.length || busy || !rights) return;
    const chosen = [...files].slice(0, Math.max(0, remaining));
    const queued: Item[] = chosen.map((file, index) => ({
      key: `${Date.now()}-${index}`,
      name: file.name,
      state: "waiting",
      kind: isVideoFile(file) ? "clip" : "photo",
    }));
    setItems(queued);
    setBusy(true);

    for (const [index, file] of chosen.entries()) {
      const item = queued[index];
      try {
        /* Refused here rather than after the upload: telling somebody their
           80MB clip is too big should not cost them 80MB of data first. */
        const refused = tooBig(file);
        if (refused) {
          mark(item.key, { state: "failed", message: refused });
          continue;
        }

        let result: UploadReply | null;
        if (isVideoFile(file)) {
          result = await sendClip(item, file);
        } else {
          mark(item.key, { state: "shrinking" });
          result = await uploadPhoto(file, folder, subject);
        }
        if (!result?.ok) {
          mark(item.key, { state: "failed", message: result?.message ?? "That file would not upload." });
          continue;
        }
        mark(item.key, { state: "done" });
      } catch {
        mark(item.key, { state: "failed", message: "That file would not upload. Check your connection." });
      }
    }

    setBusy(false);
    if (input.current) input.current.value = "";
    /* One refresh at the end rather than one per file: the shelves below are
       server-rendered and re-reading them six times would make the page jump
       under her while she is still watching the list. */
    router.refresh();
  }

  const done = items.filter((item) => item.state === "done");
  const failed = items.filter((item) => item.state === "failed");
  const full = remaining <= 0;
  const clipLimit = directUploads ? `${MAX_VIDEO_BYTES / 1024 / 1024}MB` : `${SMALL_CLIP_MB}MB`;

  return (
    <div>
      <p className="mb-4 max-w-prose text-sm text-muted">
        MP4 or MOV, up to 30 seconds and {clipLimit}.{folderName ? ` Filed in ${folderName}.` : ""} Free.
      </p>

      <fieldset className="mb-4 max-w-prose" disabled={busy}>
        <legend className="mb-1.5 text-sm font-medium text-ink">What is in these photos?</legend>
        <div className="flex flex-col gap-2 sm:flex-row">
          {SUBJECT_CHOICES.map((choice) => (
            <label key={choice.value} className="flex flex-1 cursor-pointer gap-2.5 rounded-lg border border-line bg-surface p-3 text-sm has-[:checked]:border-accent has-[:checked]:ring-1 has-[:checked]:ring-accent">
              <input
                type="radio"
                name="subject"
                value={choice.value}
                checked={subject === choice.value}
                onChange={() => setSubject(choice.value)}
                className="mt-0.5 size-4 shrink-0 accent-accent"
              />
              <span>
                <span className="block font-medium text-ink">{choice.name}</span>
                <span className="block text-muted">{choice.line}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mb-4 flex max-w-prose gap-3 text-sm text-ink">
        <input
          type="checkbox"
          checked={rights}
          onChange={(event) => setRights(event.target.checked)}
          disabled={busy}
          className="mt-0.5 size-4 shrink-0 accent-accent"
        />
        <span>
          These photos and clips are of me, or I have the rights and permissions to upload and use them here. None of
          them shows anyone under 18.
        </span>
      </label>

      <input
        ref={input}
        id="library-files"
        type="file"
        accept={UPLOAD_ACCEPT}
        multiple
        disabled={busy || full || !rights}
        className="sr-only"
        onChange={(event) => void add(event.target.files)}
      />
      <label
        htmlFor="library-files"
        aria-disabled={busy || full || !rights}
        className={`${buttonClass("primary", "lg", "w-full sm:w-auto")} ${busy || full || !rights ? "pointer-events-none opacity-55" : "cursor-pointer"}`}
      >
        {busy ? "Uploading…" : full ? "Your library is full" : "Choose photos or clips"}
      </label>

      {!rights && !full && <p className="mt-2 text-xs text-muted">Tick the box above to choose files.</p>}

      {full && (
        <p className="mt-2 text-xs text-muted">
          Open a photo or clip below and delete it, or use Select to delete several, to make room.
        </p>
      )}

      {items.length > 0 && (
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li key={item.key} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate text-ink-soft">{item.name}</span>
              <span
                className={`shrink-0 text-xs ${
                  item.state === "failed" ? "text-accent" : item.state === "done" ? "text-good" : "text-muted"
                }`}
              >
                {item.state === "waiting" && "Waiting"}
                {item.state === "shrinking" && "Shrinking…"}
                {item.state === "uploading" && (item.kind === "clip" && !item.direct ? "Uploading and checking…" : "Uploading…")}
                {item.state === "checking" && "Checking the clip…"}
                {item.state === "done" && "Added"}
                {item.state === "failed" && "Could not add"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {busy && (
        <p role="status" aria-live="polite" className="mt-3 text-xs text-muted">
          {done.length} of {items.length} added. Clips take a moment longer: we check the length and strip the location
          out of them before they are stored.
        </p>
      )}

      {!busy && failed.length > 0 && (
        <div className="mt-4 space-y-2">
          {failed.map((item) => (
            <ResultMessage key={item.key} ok={false}>
              <span className="font-medium">{item.name}</span>: {item.message}
            </ResultMessage>
          ))}
        </div>
      )}

      {!busy && done.length > 0 && failed.length === 0 && (
        <div className="mt-4">
          <ResultMessage ok>
            {done.length === 1 ? "One file added." : `${done.length} files added.`} Photos are on the Photos tab, clips on
            Clips.
          </ResultMessage>
        </div>
      )}
    </div>
  );
}

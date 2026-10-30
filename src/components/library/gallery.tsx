"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { copyUploadsAction, deleteMediaAction, moveMediaAction, setPhotoSubjectAction, setPhotoSubjectsAction } from "@/app/library/actions";
import { Badge, Button, buttonClass, MediaTile, Select } from "@/components/ui";
import { downloadHref } from "@/lib/download";
import { CheckIcon, ChevronIcon, CloseIcon, DownloadIcon, SelectIcon, TrashIcon } from "@/components/ui/icons";
import { ResultMessage } from "@/components/ui/message";
import { NO_FOLDER } from "@/data/folder-rules";
import { copyNote, copyRefusalNote } from "@/lib/uploads";

import { libraryHref } from "./paths";
import { TileActions } from "./tile-actions";

/* The grid of one tab.
 *
 * A tile opens the item in a viewer on this page — not the raw file in a new
 * tab — because a file in a new tab has no way back, no name, no folder and
 * no delete. The viewer is where one item is looked at, filed, downloaded,
 * animated or deleted; "Select" is where several are moved or deleted at
 * once. Nothing here starts a job or spends a credit; the server actions
 * behind it only file and tidy. */

export type GalleryItem = {
  id: string;
  kind: "image" | "clip";
  src: string;
  /** ISO date, from the row. */
  createdAt: string;
  folderId: string | null;
  /** What it is, in words: the scene, the movement, or the file it came from. */
  title: string;
  /** Yours, off your phone, or made here. */
  uploaded: boolean;
  /** An upload she marked as a place or a thing rather than herself. */
  scene?: boolean;
  /** A photo with words already drawn on it: kept on its own shelf, never in a folder's grid. */
  words?: boolean;
  /** Hearted, from `meta.favorite`. */
  favorite?: boolean;
  /** The avatar the row belongs to; null for rows from before rows carried one. */
  avatarId?: string | null;
  /** An upload that may be copied to another avatar: a place or thing, or a clip (see `canCopy`). */
  copyable?: boolean;
  /** The video model, for a clip made here. */
  model?: string;
  seconds?: number | null;
};

type Folder = { id: string; name: string };

/** Her avatars, for "Copy to…". Left out, or with one avatar, there is nothing to copy to. */
export type CopyOptions = { avatars: { id: string; name: string }[]; cap: number };

const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const when = (iso: string) => fmt.format(new Date(iso));

const noun = (kind: GalleryItem["kind"], count = 1) => (kind === "image" ? (count === 1 ? "photo" : "photos") : count === 1 ? "clip" : "clips");

export function Gallery({
  items,
  folders,
  kind,
  /** The folder in the URL, so a link out of here can keep it. */
  folder,
  copy,
}: {
  items: GalleryItem[];
  folders: Folder[];
  kind: GalleryItem["kind"];
  folder?: string;
  copy?: CopyOptions;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"one" | "many" | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const dialog = useRef<HTMLDialogElement>(null);
  const openIndex = items.findIndex((item) => item.id === openId);
  const open = openIndex >= 0 ? items[openIndex] : null;

  /* The viewer is a native dialog, so Escape, the backdrop and focus trapping
     come for free. It is opened by the component rather than by markup so the
     item it shows is the one that was tapped. */
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  function say(ok: boolean, text: string) {
    setNote({ ok, text });
    setTimeout(() => setNote(null), 4000);
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function leaveSelecting() {
    setSelecting(false);
    setSelected(new Set());
    setConfirm(null);
  }

  function move(ids: string[], target: string) {
    start(async () => {
      const result = await moveMediaAction(ids, target);
      say(result.ok, result.message);
      if (result.ok) {
        leaveSelecting();
        router.refresh();
      }
    });
  }

  function markSubject(id: string, subject: string) {
    start(async () => {
      const result = await setPhotoSubjectAction(id, subject);
      say(result.ok, result.message);
      if (result.ok) router.refresh();
    });
  }

  function copyTo(ids: string[], avatarId: string) {
    start(async () => {
      const result = await copyUploadsAction(ids, avatarId);
      say(result.ok, result.message);
      if (result.ok) {
        leaveSelecting();
        router.refresh();
      }
    });
  }

  function markMany(ids: string[], subject: string) {
    start(async () => {
      const result = await setPhotoSubjectsAction(ids, subject);
      say(result.ok, result.message);
      if (result.ok) {
        leaveSelecting();
        router.refresh();
      }
    });
  }

  function remove(ids: string[]) {
    start(async () => {
      const result = await deleteMediaAction(ids);
      say(result.ok, result.message);
      setConfirm(null);
      if (result.ok) {
        setOpenId(null);
        leaveSelecting();
        router.refresh();
      }
    });
  }

  function step(delta: number) {
    if (openIndex < 0) return;
    const next = items[(openIndex + delta + items.length) % items.length];
    setConfirm(null);
    setOpenId(next.id);
  }

  const allSelected = selected.size === items.length;

  /* Copying needs somewhere to copy to. The avatars offered for one item are
     every one but its own; for a selection, every one, and the server skips
     what is already there. */
  const avatars = copy && copy.avatars.length > 1 ? copy.avatars : [];
  const avatarName = (id: string | null | undefined) => avatars.find((avatar) => avatar.id === id)?.name;
  const picked = items.filter((item) => selected.has(item.id));
  /* "Copy to" shows whenever there is another avatar, so it can be found before
     the photos are marked; photos marked as her are named, not silently dropped. */
  const canCopyPicked = avatars.length > 0;
  const copyablePicked = picked.filter((item) => item.copyable);
  const herPicked = picked.filter((item) => item.kind === "image" && item.uploaded && !item.copyable).length;
  const canMarkPicked = picked.length > 0 && picked.every((item) => item.kind === "image" && item.uploaded);
  const openTargets = open ? avatars.filter((avatar) => avatar.id !== open.avatarId) : [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-sm text-muted">
          {selecting
            ? selected.size === 0
              ? `Tap the ${noun(kind, 2)} you want to move or delete.`
              : `${selected.size} of ${items.length} selected`
            : `${items.length} ${noun(kind, items.length)}. Tap one to open it.`}
        </p>
        <div className="flex items-center gap-2">
          {selecting && items.length > 1 && (
            <Button variant="ghost" size="sm" onClick={() => setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)))}>
              {allSelected ? "Select none" : "Select all"}
            </Button>
          )}
          <Button variant={selecting ? "primary" : "quiet"} size="sm" onClick={() => (selecting ? leaveSelecting() : setSelecting(true))}>
            <SelectIcon className="size-4" />
            {selecting ? "Done" : "Select"}
          </Button>
        </div>
      </div>

      {note && (
        <div className="mb-3">
          <ResultMessage ok={note.ok}>{note.text}</ResultMessage>
        </div>
      )}

      <ul aria-label={kind === "image" ? "Photos" : "Clips"} className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3 lg:grid-cols-5 xl:grid-cols-6">
        {items.map((item, index) => {
          const isSelected = selected.has(item.id);
          return (
            <li key={item.id} className="group relative">
              <button
                type="button"
                onClick={() => (selecting ? toggle(item.id) : setOpenId(item.id))}
                aria-pressed={selecting ? isSelected : undefined}
                aria-label={selecting ? `${isSelected ? "Deselect" : "Select"} ${item.title || `${noun(kind)} ${index + 1}`}` : `Open ${item.title || `${noun(kind)} ${index + 1}`}`}
                className={`block w-full rounded-lg text-left transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  isSelected ? "scale-[0.97]" : ""
                }`}
              >
                <MediaTile
                  kind={item.kind === "image" ? "image" : "video"}
                  src={item.kind === "image" ? item.src : `${item.src}#t=0.5`}
                  alt={item.title}
                  ratio="3:4"
                  playable={item.kind === "clip"}
                  badge={item.uploaded ? <Badge tone="plain">{item.scene ? "Place or thing" : "Yours"}</Badge> : undefined}
                  className={isSelected ? "rounded-lg ring-2 ring-accent ring-offset-2 ring-offset-canvas" : ""}
                />
              </button>
              {/* Beside the tile's button, not in it: a link inside a button is not a link. */}
              {!selecting && (
                <TileActions
                  target={{ type: "media", id: item.id }}
                  noun={item.kind === "image" ? "photo" : "clip"}
                  favorite={item.favorite === true}
                  download={downloadHref(item.id)}
                />
              )}
              {selecting && (
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute top-2 right-2 grid size-6 place-items-center rounded-full border-2 ${
                    isSelected ? "border-accent bg-accent text-white" : "border-white bg-black/35"
                  }`}
                >
                  {isSelected && <CheckIcon className="size-3.5" />}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {/* The selection bar sits over the bottom of the screen, above the phone's
          step bar and clear of the desktop rail, and goes away with the selection. */}
      {selecting && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-bottomnav z-30 border-t border-line bg-surface/95 px-gutter py-3 shadow-card backdrop-blur md:bottom-0 md:left-64 md:px-10">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-ink">{selected.size} selected</span>
            {confirm === "many" ? (
              <>
                <span className="text-sm text-ink-soft">
                  Delete {selected.size} {noun(kind, selected.size)} for good?
                </span>
                <Button variant="danger" size="sm" disabled={pending} onClick={() => remove([...selected])}>
                  {pending ? "Deleting…" : "Delete"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                  Keep them
                </Button>
              </>
            ) : (
              <>
                <label className="flex items-center gap-2 text-sm text-ink-soft">
                  <span className="sr-only sm:not-sr-only">Move to</span>
                  <Select
                    aria-label="Move to folder"
                    value=""
                    disabled={pending}
                    onChange={(event) => event.target.value && move([...selected], event.target.value)}
                    className="min-w-40"
                  >
                    <option value="">Choose a folder…</option>
                    {folders.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                    <option value={NO_FOLDER}>No folder</option>
                  </Select>
                </label>
                {canCopyPicked && copy && (
                  <label className="flex items-center gap-2 text-sm text-ink-soft">
                    <span className="sr-only sm:not-sr-only">Copy to</span>
                    <Select
                      aria-label="Copy to avatar"
                      value=""
                      disabled={pending || copyablePicked.length === 0}
                      onChange={(event) => event.target.value && copyTo(copyablePicked.map((item) => item.id), event.target.value)}
                      className="min-w-40"
                    >
                      <option value="">{pending ? "Copying…" : "Choose an avatar…"}</option>
                      {avatars.map((avatar) => (
                        <option key={avatar.id} value={avatar.id}>
                          {avatar.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                )}
                {canMarkPicked && (
                  <label className="flex items-center gap-2 text-sm text-ink-soft">
                    <span className="sr-only sm:not-sr-only">Mark as</span>
                    <Select
                      aria-label="Mark what is in them"
                      value=""
                      disabled={pending}
                      onChange={(event) => event.target.value && markMany([...selected], event.target.value)}
                      className="min-w-40"
                    >
                      <option value="">What is in them…</option>
                      <option value="scene">Places and things</option>
                      <option value="me">Photos of you</option>
                    </Select>
                  </label>
                )}
                <Button variant="quiet" size="sm" disabled={pending} onClick={() => setConfirm("many")}>
                  <TrashIcon className="size-4" />
                  Delete
                </Button>
                <Button variant="ghost" size="sm" onClick={leaveSelecting} className="ml-auto">
                  Cancel
                </Button>
                {canCopyPicked && copy && (
                  <span className="w-full text-xs text-muted">
                    {herPicked > 0
                      ? `${herPicked === 1 ? "1 photo is" : `${herPicked} photos are`} marked as photos of you and can't be copied. If no one is in ${herPicked === 1 ? "it" : "them"}, use "What is in them…" and choose Places and things first.`
                      : `Copying is free. Each copy counts as one of your ${copy.cap} uploads.`}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <dialog
        ref={dialog}
        onClose={() => {
          setOpenId(null);
          setConfirm(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") step(1);
          if (event.key === "ArrowLeft") step(-1);
        }}
        aria-label={open ? `${open.kind === "image" ? "Photo" : "Clip"}: ${open.title}` : undefined}
        /* Scrolls inside itself on a phone, so the delete control at the foot
           of a tall photo is reachable rather than cut off below the screen. */
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-ink shadow-card backdrop:bg-ink/60 backdrop:backdrop-blur-sm"
      >
        {open && (
          <div className="flex flex-col md:flex-row">
            <div className="relative bg-black md:w-[55%]">
              {open.kind === "image" ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img key={open.id} src={open.src} alt={open.title} className="mx-auto max-h-[50dvh] w-auto object-contain md:max-h-[80vh]" />
              ) : (
                <video
                  key={open.id}
                  src={open.src}
                  controls
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="mx-auto max-h-[50dvh] w-auto object-contain md:max-h-[80vh]"
                />
              )}
              {items.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    aria-label="Previous"
                    className="absolute top-1/2 left-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"
                  >
                    <ChevronIcon className="size-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    aria-label="Next"
                    className="absolute top-1/2 right-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"
                  >
                    <ChevronIcon className="size-5 rotate-180" />
                  </button>
                </>
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-5 p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="eyebrow text-muted">
                    {open.kind === "image" ? "Photo" : "Clip"} · {openIndex + 1} of {items.length}
                  </p>
                  <p className="mt-1.5 text-sm text-ink">{open.title || (open.kind === "image" ? "A photo of her" : "A clip of her")}</p>
                  <p className="mt-1 text-xs text-muted">
                    {open.uploaded ? "Added from your device" : "Made here"}
                    {avatarName(open.avatarId) ? ` · ${avatarName(open.avatarId)}’s` : ""} · {when(open.createdAt)}
                    {open.model ? ` · ${open.model}` : ""}
                    {open.seconds ? ` · ${Math.round(open.seconds)}s` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenId(null)}
                  aria-label="Close"
                  className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-sunken hover:text-ink"
                >
                  <CloseIcon className="size-5" />
                </button>
              </div>

              {/* Folders hold the photos the app made; uploads and photos with
                  words keep to their own shelves, so filing one would hide it. */}
              {!(open.kind === "image" && (open.uploaded || open.words)) && (
              <label className="block">
                <span className="block text-xs font-medium text-muted">Folder</span>
                <Select
                  value={open.folderId ?? NO_FOLDER}
                  disabled={pending}
                  onChange={(event) => move([open.id], event.target.value)}
                  className="mt-1"
                >
                  <option value={NO_FOLDER}>Not in a folder</option>
                  {folders.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
                {folders.length === 0 && (
                  <span className="mt-1 block text-xs text-muted">Make a folder above the grid to file things.</span>
                )}
              </label>
              )}

              {open.kind === "image" && open.uploaded && (
                <label className="block">
                  <span className="block text-xs font-medium text-muted">What is in it</span>
                  <Select
                    value={open.scene ? "scene" : "me"}
                    disabled={pending}
                    onChange={(event) => markSubject(open.id, event.target.value)}
                    className="mt-1"
                  >
                    <option value="me">Me</option>
                    <option value="scene">A place or thing</option>
                  </Select>
                  <span className="mt-1 block text-xs text-muted">
                    Places and things are used in half-and-half and four-photo carousels, never as a photo of you.
                  </span>
                </label>
              )}

              {open.uploaded && openTargets.length > 0 && copy && (
                <div>
                  <span className="block text-xs font-medium text-muted">Copy to another avatar</span>
                  {open.copyable ? (
                    <>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {openTargets.map((avatar) => (
                          <Button key={avatar.id} variant="quiet" size="sm" disabled={pending} onClick={() => copyTo([open.id], avatar.id)}>
                            {pending ? "Copying…" : `Copy to ${avatar.name}`}
                          </Button>
                        ))}
                      </div>
                      <span className="mt-1 block text-xs text-muted">
                        {copyNote(open.kind === "clip" ? "clips" : "places", openTargets.length === 1 ? openTargets[0].name : null, copy.cap)}
                      </span>
                    </>
                  ) : (
                    <span className="mt-1 block text-xs text-muted">{copyRefusalNote(avatarName(open.avatarId) ?? "this avatar")}</span>
                  )}
                  {/* The grid's message is behind the viewer; this one is where the button was pressed. */}
                  {note && (
                    <div className="mt-2">
                      <ResultMessage ok={note.ok}>{note.text}</ResultMessage>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {open.kind === "image" ? (
                  <Link
                    href={libraryHref("videos", folder ?? (open.folderId ?? undefined), { animate: open.id })}
                    className={buttonClass("primary", "md")}
                  >
                    Animate this photo
                  </Link>
                ) : (
                  <Link href="/create" className={buttonClass("primary", "md")}>
                    Put a hook on it
                  </Link>
                )}
                <a href={downloadHref(open.id)} download className={buttonClass("quiet", "md")}>
                  <DownloadIcon className="size-4" />
                  Download
                </a>
              </div>

              <div className="mt-auto border-t border-line pt-4">
                {confirm === "one" ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm text-ink-soft">
                      Delete this {noun(open.kind)} for good?
                      {open.kind === "clip" ? " Reels already made from it are kept." : ""}
                    </span>
                    <Button variant="danger" size="sm" disabled={pending} onClick={() => remove([open.id])}>
                      {pending ? "Deleting…" : "Delete"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                      Keep it
                    </Button>
                  </div>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setConfirm("one")} className="text-muted">
                    <TrashIcon className="size-4" />
                    Delete this {noun(open.kind)}
                  </Button>
                )}

              </div>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}

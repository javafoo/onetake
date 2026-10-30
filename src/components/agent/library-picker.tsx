"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import type { AttachedKind } from "@/agent/composer";
import { libraryItemsAction, savedHooksAction, type LibraryItem, type SavedHookItem } from "@/app/create/actions";
import { isVideoFile, tooBig, UPLOAD_ACCEPT, uploadClip, uploadPhoto } from "@/components/library/upload-client";
import { Button, MediaTile } from "@/components/ui";
import { Input } from "@/components/ui/field";
import { ResultMessage } from "@/components/ui/message";

import { Modal } from "./modal";

/* The + picker: her library, to attach photos or a clip to the message as
   material, or a saved hook to pin. Read through the same scoped lists the
   Library and Hooks pages use, and uploads go through the Library page's own
   upload path. On a phone the tabs sit in a row, the list below them and the
   preview under the list. */

/** What the chat carries for an attached item: enough to draw the thumbnail. */
export type PickedItem = { kind: AttachedKind; id: string; src: string; title: string };
/** A saved hook picked here: pinned like `?hook=`, with its id so it is marked used. */
export type PickedHook = { id: string; text: string };

type Tab = "all" | "photos" | "clips" | "uploads" | "hooks";
const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "photos", label: "Photos" },
  { id: "clips", label: "Clips" },
  { id: "uploads", label: "Uploads" },
  { id: "hooks", label: "Hooks" },
];

function hookMatches(hook: SavedHookItem, query: string): boolean {
  const words = query.trim().toLowerCase();
  return !words || hook.text.toLowerCase().includes(words);
}

const KIND_LABEL: Record<AttachedKind, string> = { photo: "Photo", clip: "Clip" };

function matches(item: LibraryItem, tab: Tab, query: string): boolean {
  if (tab === "photos" && item.kind !== "photo") return false;
  if (tab === "clips" && item.kind !== "clip") return false;
  if (tab === "uploads" && !item.uploaded) return false;
  const words = query.trim().toLowerCase();
  return !words || item.title.toLowerCase().includes(words) || KIND_LABEL[item.kind].toLowerCase().includes(words);
}

export function LibraryPicker({
  onAdd,
  onPickHook,
  onClose,
  initialTab = "all",
}: {
  onAdd: (item: PickedItem) => void;
  onPickHook: (hook: PickedHook) => void;
  onClose: () => void;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [hooks, setHooks] = useState<SavedHookItem[] | null>(null);
  const [hookId, setHookId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [rights, setRights] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [, startLoad] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    startLoad(async () => {
      const result = await libraryItemsAction();
      if (result.ok) setItems(result.items);
      else setProblem(result.message);
    });
  }, []);

  // Hooks are read the first time the tab is opened, not with the library.
  useEffect(() => {
    if (tab !== "hooks" || hooks !== null) return;
    startLoad(async () => {
      const result = await savedHooksAction();
      if (result.ok) setHooks(result.hooks);
      else setProblem(result.message);
    });
  }, [tab, hooks]);

  const onHooks = tab === "hooks";
  const shown = (items ?? []).filter((item) => matches(item, tab, query));
  const shownHooks = (hooks ?? []).filter((hook) => hookMatches(hook, query));
  const current = onHooks ? null : items?.find((item) => item.id === selected) ?? null;
  const currentHook = onHooks ? hooks?.find((hook) => hook.id === hookId) ?? null : null;

  async function upload(file: File) {
    setProblem(null);
    const refused = tooBig(file);
    if (refused) {
      setProblem(refused);
      return;
    }
    setUploading(isVideoFile(file) ? "Uploading the clip…" : "Uploading the photo…");
    try {
      const reply = isVideoFile(file)
        ? await uploadClip(file, undefined, (stage) => setUploading(stage === "checking" ? "Checking the clip…" : "Uploading the clip…"))
        : await uploadPhoto(file);
      if (!reply?.ok || !reply.id) {
        setProblem(reply?.message ?? "That file would not upload.");
        return;
      }
      const added: LibraryItem = {
        id: reply.id,
        kind: reply.kind === "clip" ? "clip" : "photo",
        src: reply.url ?? `/api/media/${reply.id}`,
        title: file.name,
        uploaded: true,
        createdAt: new Date().toISOString(),
        seconds: reply.durationSeconds ?? null,
      };
      setItems((current) => [added, ...(current ?? [])]);
      setSelected(added.id);
    } catch {
      setProblem("That file would not upload. Check your connection.");
    } finally {
      setUploading(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <Modal full
      title="Add from your library"
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 truncate text-sm text-muted">
            {currentHook ? `Hook: ${currentHook.text}` : current ? `${KIND_LABEL[current.kind]}: ${current.title || "untitled"}` : onHooks ? "Pick a hook." : "Pick a photo or a clip."}
          </p>
          <Button
            disabled={onHooks ? !currentHook : !current}
            onClick={() => {
              if (currentHook) {
                onPickHook({ id: currentHook.id, text: currentHook.text });
                onClose();
                return;
              }
              if (!current) return;
              onAdd({ kind: current.kind, id: current.id, src: current.src, title: current.title });
              onClose();
            }}
          >
            {onHooks ? "Use this hook" : "Add to prompt"}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 sm:h-[60vh] sm:grid-cols-[7rem_1fr_13rem]">
        <nav aria-label="Library" className="flex gap-1 overflow-x-auto sm:flex-col">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`min-h-10 shrink-0 rounded-lg px-3 text-left text-sm ${tab === item.id ? "bg-sunken font-medium text-ink" : "text-ink-soft hover:bg-sunken/60 hover:text-ink"}`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <section className="flex min-h-0 flex-col gap-3">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={onHooks ? "Search your hooks" : "Search by name or scene"}
            aria-label={onHooks ? "Search your hooks" : "Search the library"}
          />

          {onHooks ? (
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto sm:pr-1">
              {hooks === null && !problem && <li className="px-2 py-6 text-center text-sm text-muted">Loading your hooks…</li>}
              {hooks !== null && shownHooks.length === 0 && (
                <li className="px-2 py-6 text-center text-sm text-muted">{hooks.length ? "No hook has those words." : "No saved hooks yet. Save one from a finished reel, or add one on the Hooks page."}</li>
              )}
              {shownHooks.map((hook) => (
                <li key={hook.id}>
                  <button
                    type="button"
                    onClick={() => setHookId(hook.id)}
                    aria-pressed={hookId === hook.id}
                    className={`w-full rounded-lg border p-2.5 text-left transition-colors ${hookId === hook.id ? "border-accent bg-accent-soft" : "border-transparent hover:bg-sunken/60"}`}
                  >
                    <span className="line-clamp-3 whitespace-pre-line text-sm text-ink">{hook.text}</span>
                    {hook.used && <span className="mt-1 block text-xs text-muted">Used before</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
          <>
          <div className="rounded-lg border border-line bg-sunken/40 p-3">
            <label className="flex gap-2 text-xs text-ink-soft">
              <input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)} disabled={Boolean(uploading)} className="mt-0.5 size-4 shrink-0 accent-accent" />
              <span>
                This is of me, or I have the rights to use it here. Nobody under 18.
              </span>
            </label>
            <input ref={fileInput} type="file" accept={UPLOAD_ACCEPT} className="sr-only" disabled={!rights || Boolean(uploading)} onChange={(event) => void (event.target.files?.[0] && upload(event.target.files[0]))} />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button variant="quiet" size="sm" disabled={!rights || Boolean(uploading)} onClick={() => fileInput.current?.click()}>
                {uploading ?? "Upload a photo or clip"}
              </Button>
              <span className="text-xs text-muted">Free. It goes in your library too.</span>
            </div>
          </div>

          {problem && <ResultMessage ok={false}>{problem}</ResultMessage>}

          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto sm:pr-1">
            {items === null && !problem && <li className="px-2 py-6 text-center text-sm text-muted">Loading your library…</li>}
            {items !== null && shown.length === 0 && <li className="px-2 py-6 text-center text-sm text-muted">Nothing here yet.</li>}
            {shown.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setSelected(item.id)}
                  aria-pressed={selected === item.id}
                  className={`flex w-full items-center gap-3 rounded-lg border p-1.5 text-left transition-colors ${selected === item.id ? "border-accent bg-accent-soft" : "border-transparent hover:bg-sunken/60"}`}
                >
                  <span className="w-12 shrink-0">
                    <MediaTile kind={item.kind === "clip" ? "video" : "image"} src={item.src} ratio="4:5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{item.title || (item.kind === "clip" ? "A clip" : "A photo")}</span>
                    <span className="block text-xs text-muted">
                      {KIND_LABEL[item.kind]}
                      {item.uploaded ? " · uploaded" : ""}
                      {item.seconds ? ` · ${Math.round(item.seconds)}s` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          </>
          )}
        </section>

        <aside className="sm:min-h-0 sm:overflow-y-auto">
          {currentHook ? (
            <div className="rounded-lg border border-line bg-surface p-3">
              <p className="whitespace-pre-line text-sm text-ink">{currentHook.text}</p>
              <p className="mt-2 text-xs text-muted">Used word for word: on a reel with a clip attached, or as the cover on Slides.</p>
            </div>
          ) : current ? (
            <div>
              <MediaTile kind={current.kind === "clip" ? "video" : "image"} src={current.src} ratio={current.kind === "clip" ? "9:16" : "4:5"} controls={current.kind === "clip"} />
              <p className="mt-2 text-sm text-ink">{current.title || (current.kind === "clip" ? "A clip" : "A photo")}</p>
              <p className="text-xs text-muted">
                {current.kind === "clip"
                  ? "Type words to put on it: that makes a reel, free."
                  : "Image: a new photo from it. Video: animate it. Slides: use it in the set. You can add up to ten photos."}
              </p>
            </div>
          ) : (
            <div className="hidden rounded-lg border border-dashed border-line-strong p-4 text-center text-xs text-muted sm:block">Tap an item to see it here.</div>
          )}
        </aside>
      </div>
    </Modal>
  );
}

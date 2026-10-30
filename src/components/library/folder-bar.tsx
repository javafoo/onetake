"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createFolderAction, deleteFolderAction, renameFolderAction } from "@/app/library/actions";
import { Button, Input } from "@/components/ui";
import { FolderIcon, PlusIcon } from "@/components/ui/icons";
import { ResultMessage } from "@/components/ui/message";
import { MAX_FOLDER_NAME, NO_FOLDER } from "@/data/folder-rules";

import { libraryHref, type LibraryTab } from "./paths";
import { SHELF_LABEL, SHELVES, type OpenShelf } from "./shelves";

/* The row of folders under the tabs.
 *
 * Folders are chips, not a tree, and the whole row is links: switching folder
 * is a navigation, so the back button works and a folder can be bookmarked.
 * Making, renaming and deleting happen inline in this row, with no dialog to
 * find and no page to leave. What is open here is where new things land: a
 * photo generated with "Beach day" open is filed in Beach day. */

export type FolderChip = { id: string; name: string; count: number };

const CHIP = "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors";
const CHIP_ON = "border-ink bg-ink text-canvas";
const CHIP_OFF = "border-line-strong bg-surface text-ink-soft hover:border-ink hover:text-ink";

export function FolderBar({
  tab,
  folders,
  current,
  all,
  unfiled,
  shelves,
  shelf = null,
}: {
  tab: LibraryTab;
  folders: FolderChip[];
  /** Folder id, "none", or undefined for everything. */
  current?: string;
  /** How many of this tab's items there are in all. */
  all: number;
  /** How many of this tab's items are not in a folder. */
  unfiled: number;
  /** Photos only: how many are on each shelf that fills itself, and which is open. */
  shelves?: Record<OpenShelf, number>;
  shelf?: OpenShelf | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"idle" | "new" | "rename" | "delete">("idle");
  const [name, setName] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const open = folders.find((folder) => folder.id === current) ?? null;

  function say(ok: boolean, text: string) {
    setNote({ ok, text });
    setTimeout(() => setNote(null), 4000);
  }

  function make() {
    start(async () => {
      const result = await createFolderAction(name);
      if (result.ok && result.id) {
        setMode("idle");
        setName("");
        router.push(libraryHref(tab, result.id));
      }
      say(result.ok, result.message);
    });
  }

  function rename() {
    if (!open) return;
    start(async () => {
      const result = await renameFolderAction(open.id, name);
      if (result.ok) {
        setMode("idle");
        router.refresh();
      }
      say(result.ok, result.message);
    });
  }

  function remove() {
    if (!open) return;
    start(async () => {
      const result = await deleteFolderAction(open.id);
      if (result.ok) {
        setMode("idle");
        router.push(libraryHref(tab));
      }
      say(result.ok, result.message);
    });
  }

  const showUnfiled = folders.length > 0 && (unfiled > 0 || current === NO_FOLDER);

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={libraryHref(tab)} aria-current={!current && !shelf ? "page" : undefined} className={`${CHIP} ${!current && !shelf ? CHIP_ON : CHIP_OFF}`}>
          All
          <span className={`text-xs tabular-nums ${!current && !shelf ? "text-canvas/70" : "text-muted"}`}>{all}</span>
        </Link>
        {folders.map((folder) => {
          const active = folder.id === current;
          return (
            <Link
              key={folder.id}
              href={libraryHref(tab, folder.id)}
              aria-current={active ? "page" : undefined}
              className={`${CHIP} ${active ? CHIP_ON : CHIP_OFF}`}
            >
              <FolderIcon className={`size-4 ${active ? "text-canvas/80" : "text-muted"}`} />
              <span className="max-w-[12rem] truncate">{folder.name}</span>
              <span className={`text-xs tabular-nums ${active ? "text-canvas/70" : "text-muted"}`}>{folder.count}</span>
            </Link>
          );
        })}
        {showUnfiled && (
          <Link
            href={libraryHref(tab, NO_FOLDER)}
            aria-current={current === NO_FOLDER ? "page" : undefined}
            className={`${CHIP} ${current === NO_FOLDER ? CHIP_ON : CHIP_OFF}`}
          >
            Not in a folder
            <span className={`text-xs tabular-nums ${current === NO_FOLDER ? "text-canvas/70" : "text-muted"}`}>{unfiled}</span>
          </Link>
        )}
        {/* The shelves that fill themselves, set apart from her own folders by a
            rule: she cannot rename or delete them, and nothing is filed there by hand. */}
        {shelves && (
          <>
            <span aria-hidden className="mx-1 h-6 w-px bg-line-strong" />
            {SHELVES.map((id) => {
              const active = shelf === id;
              return (
                <Link
                  key={id}
                  href={libraryHref(tab, undefined, { shelf: id })}
                  aria-current={active ? "page" : undefined}
                  className={`${CHIP} ${active ? CHIP_ON : CHIP_OFF}`}
                >
                  {SHELF_LABEL[id].name}
                  <span className={`text-xs tabular-nums ${active ? "text-canvas/70" : "text-muted"}`}>{shelves[id]}</span>
                </Link>
              );
            })}
          </>
        )}
        {mode !== "new" && (
          <button
            type="button"
            onClick={() => {
              setName("");
              setMode("new");
            }}
            className={`${CHIP} border-dashed ${CHIP_OFF}`}
          >
            <PlusIcon className="size-4" />
            New folder
          </button>
        )}
      </div>

      {mode === "new" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            make();
          }}
          className="mt-3 flex flex-wrap items-center gap-2"
        >
          <label className="sr-only" htmlFor="new-folder-name">
            Folder name
          </label>
          <Input
            id="new-folder-name"
            autoFocus
            value={name}
            maxLength={MAX_FOLDER_NAME}
            placeholder="Beach day, Q4 launch, Studio…"
            onChange={(event) => setName(event.target.value)}
            className="w-full sm:w-64"
          />
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending ? "Making…" : "Make folder"}
          </Button>
          <Button variant="ghost" onClick={() => setMode("idle")}>
            Cancel
          </Button>
        </form>
      )}

      {open && mode === "idle" && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>New photos and clips you make with this folder open are filed here.</span>
          <button
            type="button"
            onClick={() => {
              setName(open.name);
              setMode("rename");
            }}
            className="min-h-8 font-medium text-ink-soft underline-offset-4 hover:underline"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => setMode("delete")}
            className="min-h-8 font-medium text-ink-soft underline-offset-4 hover:underline"
          >
            Delete folder
          </button>
        </div>
      )}

      {open && mode === "rename" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            rename();
          }}
          className="mt-3 flex flex-wrap items-center gap-2"
        >
          <label className="sr-only" htmlFor="rename-folder-name">
            New name
          </label>
          <Input
            id="rename-folder-name"
            autoFocus
            value={name}
            maxLength={MAX_FOLDER_NAME}
            onChange={(event) => setName(event.target.value)}
            className="w-full sm:w-64"
          />
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending ? "Saving…" : "Save name"}
          </Button>
          <Button variant="ghost" onClick={() => setMode("idle")}>
            Cancel
          </Button>
        </form>
      )}

      {open && mode === "delete" && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-sunken px-4 py-3 text-sm text-ink-soft">
          <span>
            Delete the folder <span className="font-semibold text-ink">{open.name}</span>? Nothing in it is deleted; it all
            stays in your library, just not in a folder.
          </span>
          <Button variant="danger" size="sm" disabled={pending} onClick={remove}>
            {pending ? "Deleting…" : "Yes, delete the folder"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setMode("idle")}>
            Keep it
          </Button>
        </div>
      )}

      {note && (
        <div className="mt-3">
          <ResultMessage ok={note.ok}>{note.text}</ResultMessage>
        </div>
      )}
    </div>
  );
}

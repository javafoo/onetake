"use server";

import { revalidatePath } from "next/cache";

import { checkSavedHook } from "@/content/draft-edit";
import { photoShelf } from "@/components/library/shelves";
import { parseHookQuery } from "@/data/hook-rules";
import { addHook, listHooks } from "@/data/hooks";
import { listMedia, mediaUrl, type Media } from "@/data/media";
import { guardedAction } from "@/lib/action-guard";
import { InvalidRequestError } from "@/lib/errors";
import { currentAvatar } from "@/lib/current-avatar";

/* What the Create chat reads and writes beside the agent: saved hooks and the
   library picker. The agent itself is `src/agent/v2`. */

export type SaveHookState = { ok: true; message: string } | { ok: false; message: string };

/**
 * Keep a hook from a finished reel or set on the Hooks page: the words alone,
 * no caption. The same words saved twice for the same avatar are refused,
 * compared trimmed and case-insensitively, by the database itself.
 */
export async function saveHookAction(text: string): Promise<SaveHookState> {
  const form = new FormData();
  return guardedAction<string, SaveHookState>(form, {
    where: "saveHookAction",
    run: async (user) => {
      // A saved hook is words kept for later, not a reel yet: the reel's word limit does not apply.
      const hook = checkSavedHook(typeof text === "string" ? text : "");
      const avatar = await currentAvatar(user.id);
      if (!avatar) throw new InvalidRequestError("Finish her setup first.");
      await addHook(user.id, avatar.id, hook);
      revalidatePath("/hooks");
      return "Hook saved.";
    },
    done: (message) => ({ ok: true, message }),
    failed: (message) => ({ ok: false, message }),
  });
}

export type LibraryItem = {
  id: string;
  kind: "photo" | "clip";
  src: string;
  /** The scene or the movement it was made from, or the file it was uploaded as. */
  title: string;
  uploaded: boolean;
  createdAt: string;
  seconds: number | null;
};

export type LibraryListState = { ok: true; items: LibraryItem[] } | { ok: false; message: string };

function libraryItem(row: Media): LibraryItem {
  const meta = row.meta as { idea?: string; motion?: string; originalName?: string; source?: string };
  const uploaded = meta.source === "upload";
  const title = uploaded ? meta.originalName ?? "" : row.kind === "image" ? meta.idea ?? "" : meta.motion ?? "";
  return {
    id: row.id,
    kind: row.kind === "image" ? "photo" : "clip",
    src: mediaUrl(row.id),
    title,
    uploaded,
    createdAt: row.createdAt.toISOString(),
    seconds: row.durationSeconds == null ? null : Number(row.durationSeconds),
  };
}

/** Her photos and clips, newest first, for the + picker. Read scoped to the session's user, like the Library page. */
export async function libraryItemsAction(): Promise<LibraryListState> {
  const form = new FormData();
  return guardedAction<LibraryItem[], LibraryListState>(form, {
    where: "libraryItemsAction",
    run: async (user) => {
      const avatar = await currentAvatar(user.id);
      const scope = { keptOnly: true, avatarId: avatar?.id, orUnassigned: true } as const;
      const [photos, clips] = await Promise.all([listMedia(user.id, "image", scope), listMedia(user.id, "clip", scope)]);
      // Quote photos stay off the +: they already carry words, and anything built on one would draw text over text.
      const buildable = photos.filter((photo) => photoShelf(photo.meta) !== "words");
      return [...buildable, ...clips].map(libraryItem).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    done: (items) => ({ ok: true, items }),
    failed: (message) => ({ ok: false, message }),
  });
}

/* ------------------------------------------------------------------ */
/* The + picker's Hooks tab                                            */
/* ------------------------------------------------------------------ */

export type SavedHookItem = { id: string; text: string; createdAt: string; used: boolean };
export type SavedHooksState = { ok: true; hooks: SavedHookItem[] } | { ok: false; message: string };

/** The current avatar's saved hooks, not archived, newest first, for the + picker. Scoped to the session's user. */
export async function savedHooksAction(input: { query?: string } = {}): Promise<SavedHooksState> {
  return guardedAction<SavedHookItem[], SavedHooksState>(new FormData(), {
    where: "savedHooksAction",
    run: async (user) => {
      const avatar = await currentAvatar(user.id);
      if (!avatar) return [];
      const query = typeof input.query === "string" ? parseHookQuery(input.query) : "";
      const rows = await listHooks(user.id, avatar.id, { activeOnly: true, query: query || undefined });
      return rows.map((row) => ({
        id: row.id,
        text: row.text,
        createdAt: row.createdAt.toISOString(),
        used: Boolean(row.usedReelAt || row.usedCarouselAt || row.copiedAt),
      }));
    },
    done: (hooks) => ({ ok: true, hooks }),
    failed: (message) => ({ ok: false, message }),
  });
}

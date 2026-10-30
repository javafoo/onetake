"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { createFolder, deleteFolder, renameFolder, requireOwnFolder } from "@/data/folders";
import { photoSubject } from "@/carousel/match";
import { getAvatar } from "@/data/avatars";
import {
  copyMediaToAvatar,
  copyRootsOnAvatar,
  deleteManyMedia,
  getManyMedia,
  getMedia,
  MediaLimitReachedError,
  moveMedia,
  updateMediaMeta,
} from "@/data/media";
import { requireUser } from "@/data/users";
import { InvalidRequestError, userMessage } from "@/lib/errors";
import { copiedMeta, copyResultMessage, copyRoot, isUpload, planCopies } from "@/lib/uploads";

/* Filing and tidying the library.
 *
 * These are called from the gallery and the folder bar directly rather than
 * through a form, and none of them starts a job or spends a credit. Each one
 * is safe to repeat: moving what is already there is a no-op, deleting what
 * is already gone deletes nothing. So they take plain arguments and hand back
 * one shape, and the session check is the first line of every one. */

export type LibraryResult = { ok: true; message: string; id?: string } | { ok: false; message: string };

async function tidy(where: string, run: (userId: string) => Promise<{ message: string; id?: string }>): Promise<LibraryResult> {
  try {
    const user = await requireUser();
    const outcome = await run(user.id);
    revalidatePath("/", "layout");
    return { ok: true, ...outcome };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: userMessage(where, error) };
  }
}

/** At most this many ids in one call; the gallery never offers more than a screen. */
const MAX_IDS = 100;
const ids = (value: unknown): string[] =>
  (Array.isArray(value) ? value : []).filter((id): id is string => typeof id === "string").slice(0, MAX_IDS);

export async function createFolderAction(name: string): Promise<LibraryResult> {
  return tidy("createFolderAction", async (userId) => {
    const folder = await createFolder(userId, name);
    return { message: `Folder "${folder.name}" made.`, id: folder.id };
  });
}

export async function renameFolderAction(folderId: string, name: string): Promise<LibraryResult> {
  return tidy("renameFolderAction", async (userId) => {
    const folder = await renameFolder(userId, folderId, name);
    if (!folder) throw new Error("That folder does not exist.");
    return { message: `Renamed to "${folder.name}".`, id: folder.id };
  });
}

/** The folder goes; what was in it stays in the library, unfiled. */
export async function deleteFolderAction(folderId: string): Promise<LibraryResult> {
  return tidy("deleteFolderAction", async (userId) => {
    const gone = await deleteFolder(userId, folderId);
    if (!gone) throw new Error("That folder does not exist.");
    return { message: "Folder deleted. Everything in it is still in your library." };
  });
}

/** `folder` is a folder id, or "none" to take the items out of their folder. */
export async function moveMediaAction(mediaIds: unknown, folder: string): Promise<LibraryResult> {
  return tidy("moveMediaAction", async (userId) => {
    const target = (await requireOwnFolder(userId, folder)) ?? null;
    const moved = await moveMedia(userId, ids(mediaIds), target);
    return { message: moved === 1 ? "Moved." : `Moved ${moved} items.` };
  });
}

/**
 * Marks a photo she uploaded as herself, or as a place or a thing. Only her
 * own uploads: a photo made here is always of her, and that is what decides
 * which carousels may use it.
 */
export async function setPhotoSubjectAction(mediaId: string, subject: string): Promise<LibraryResult> {
  return tidy("setPhotoSubjectAction", async (userId) => {
    const media = await getMedia(userId, mediaId);
    if (!media || media.kind !== "image" || (media.meta as { source?: unknown }).source !== "upload") {
      throw new Error("Only photos you added yourself can be marked.");
    }
    const next = subject === "scene" ? "scene" : "me";
    if (photoSubject(media.meta) !== next) await updateMediaMeta(userId, mediaId, { subject: next });
    return {
      message: next === "scene" ? "Marked as a place or thing. Half-and-half and four-photo carousels can use it." : "Marked as a photo of you.",
    };
  });
}

/**
 * The same, for several photos picked with Select. Rows that are not her own
 * uploaded photos are left alone and not counted.
 */
export async function setPhotoSubjectsAction(mediaIds: unknown, subject: string): Promise<LibraryResult> {
  return tidy("setPhotoSubjectsAction", async (userId) => {
    const next = subject === "scene" ? "scene" : "me";
    let marked = 0;
    for (const media of await getManyMedia(userId, ids(mediaIds))) {
      if (media.kind !== "image" || !isUpload(media)) continue;
      if (photoSubject(media.meta) !== next) await updateMediaMeta(userId, media.id, { subject: next });
      marked += 1;
    }
    if (marked === 0) throw new InvalidRequestError("Only photos you added yourself can be marked.");
    const what = next === "scene" ? "a place or thing" : "a photo of you";
    return { message: marked === 1 ? `Marked as ${what}.` : `Marked ${marked} photos as ${next === "scene" ? "places and things" : "photos of you"}.` };
  });
}

/**
 * Copies some of her uploads to another of her avatars, as if they had been
 * added there: a new row on that avatar with its own stored object, the same
 * kind and the same "what is in it" mark, so its carousels and reels pick it
 * up the same way. Free. Both ends are checked: the avatar is looked up as
 * hers, and only her own rows are read. Photos of her are refused (see
 * `canCopy`), and anything already on that avatar is skipped, so pressing
 * twice copies once.
 */
export async function copyUploadsAction(mediaIds: unknown, avatarId: string): Promise<LibraryResult> {
  return tidy("copyUploadsAction", async (userId) => {
    const avatar = typeof avatarId === "string" ? await getAvatar(userId, avatarId) : null;
    if (!avatar) throw new InvalidRequestError("That avatar is not on your account. Reload the page.");

    const sources = await getManyMedia(userId, ids(mediaIds));
    if (sources.length === 0) throw new InvalidRequestError("Those items are gone. Reload the page.");
    const onTarget = await copyRootsOnAvatar(userId, avatar.id, sources.map(copyRoot));
    const plan = planCopies(sources, avatar.id, onTarget);

    let copied = 0;
    let full = false;
    const now = new Date();
    for (const source of plan.copy) {
      try {
        await copyMediaToAvatar(userId, source, avatar.id, copiedMeta(source, now));
        copied += 1;
      } catch (error) {
        if (!(error instanceof MediaLimitReachedError)) throw error;
        full = true;
        break;
      }
    }
    const later = plan.later + (full ? plan.copy.length - copied : 0);
    const message = copyResultMessage({ copied, already: plan.already, refused: plan.refused, later, full }, avatar.name);
    if (copied === 0 && full) throw new InvalidRequestError(message);
    return { message };
  });
}

/**
 * Deletes library items for good: the bytes go with the row. A reel's draft
 * goes back to written, a clip's drafts lose their clip. Nothing here asks
 * "are you sure" — the screen does, before it calls this.
 */
export async function deleteMediaAction(mediaIds: unknown): Promise<LibraryResult> {
  return tidy("deleteMediaAction", async (userId) => {
    const gone = await deleteManyMedia(userId, ids(mediaIds));
    return { message: gone === 1 ? "Deleted." : `Deleted ${gone} items.` };
  });
}

/** What can be a favorite here. A set is a draft, not a media row: see `setSetFavoriteAction`. */
const FAVORITE_KINDS = new Set<string>(["image", "clip", "reel"]);

/**
 * Marks a photo, a clip or a reel as a favorite, or takes the mark off. The
 * flag is `meta.favorite`, so a favorite costs no column and survives a move
 * between folders. The row is looked up as hers before it is touched.
 */
export async function setFavoriteAction(mediaId: string, on: boolean): Promise<LibraryResult> {
  return tidy("setFavoriteAction", async (userId) => {
    const media = await getMedia(userId, mediaId);
    if (!media || !FAVORITE_KINDS.has(media.kind)) throw new InvalidRequestError("That item is gone. Reload the page.");
    await updateMediaMeta(userId, mediaId, { favorite: on === true });
    return { message: on === true ? "Added to favorites." : "Removed from favorites." };
  });
}

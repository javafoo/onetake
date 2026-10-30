"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { stagePath } from "@/app/onboarding/flow";
import { getAvatar, identityLock, updateAvatar } from "@/data/avatars";
import { deleteMedia, setSetupPhotosRetired } from "@/data/media";
import { beginSession, completeSession, getSession, listUploads } from "@/data/onboarding";
import { requireUser, type User } from "@/data/users";
import { lockFromEdit, lockWithStyle } from "@/identity/edit-lock";
import { guardedAction } from "@/lib/action-guard";
import { rememberAvatar } from "@/lib/current-avatar";
import { start } from "@/onboarding/state";
import { isPhotoStyle, PHOTO_STYLE_LABEL, photoStyleOf } from "@/style/photo-style";
import { InvalidRequestError } from "@/lib/errors";

import type { ActionState } from "../actions";

const text = (form: FormData, key: string) => String(form.get(key) ?? "");

function guarded(where: string, form: FormData, run: (user: User) => Promise<string>): Promise<ActionState> {
  return guardedAction<string, ActionState>(form, {
    where,
    run,
    done: (message) => ({ ok: true, message }),
    failed: (message) => ({ ok: false, message }),
  });
}

/**
 * Her description, edited after setup: the same fields the review screen
 * saves, for any avatar of hers, at any time. The next photo uses it. Free:
 * nothing is generated, and the photos she already has are not touched.
 */
export async function editDescriptionAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded("editDescriptionAction", form, async (user) => {
    const avatar = await getAvatar(user.id, text(form, "id"));
    if (!avatar) throw new InvalidRequestError("That avatar is gone. Reload the page.");
    const existing = identityLock(avatar);
    if (!existing) throw new InvalidRequestError("She has no description yet. Finish her setup first.");

    // The house lists are server-only and loaded here; the check itself is pure.
    const style = await import("@/style/house-style");
    const result = lockFromEdit(
      existing,
      {
        subject: text(form, "subject"),
        hair: text(form, "hair"),
        skinMakeup: text(form, "skinMakeup"),
        accessories: text(form, "accessories"),
        expressions: text(form, "expressions"),
        wardrobe: text(form, "wardrobe"),
        scenes: text(form, "scenes"),
      },
      [...style.ETHNICITY_WORDS, ...style.bannedWordsFor(photoStyleOf(existing))],
    );
    if (!result.ok) throw new InvalidRequestError(result.message);

    await updateAvatar(user.id, avatar.id, { lock: result.lock });
    revalidatePath("/avatar");
    return "Saved. Her next photos use the new description; the ones she has already are not changed.";
  });
}

/**
 * How her photos are made, switched without touching her photos. Free: the
 * next photo is written and judged in the new style; the ones she has are not
 * changed. A switch is refused if her description uses a word the new style
 * never writes.
 */
export async function setPhotoStyleAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded("setPhotoStyleAction", form, async (user) => {
    const avatar = await getAvatar(user.id, text(form, "id"));
    if (!avatar) throw new InvalidRequestError("That avatar is gone. Reload the page.");
    const existing = identityLock(avatar);
    if (!existing) throw new InvalidRequestError("She has no description yet. Finish her setup first.");
    const style = text(form, "style");
    if (!isPhotoStyle(style)) throw new InvalidRequestError("Pick a photo style.");

    const house = await import("@/style/house-style");
    const result = lockWithStyle(existing, style, [...house.ETHNICITY_WORDS, ...house.bannedWordsFor(style)]);
    if (!result.ok) throw new InvalidRequestError(result.message);

    await updateAvatar(user.id, avatar.id, { lock: result.lock });
    revalidatePath("/", "layout");
    return `Saved. Her next photos are made in the ${PHOTO_STYLE_LABEL[style].name.toLowerCase()} style; the ones she has are not changed.`;
  });
}

/**
 * Start a new set of reference photos for an avatar that is already set up.
 * It reuses the two photo screens of setup, in a run that ends after them: her
 * description is written again from the new photos and the interview is never
 * asked again. Her old photos are set aside, not deleted, and she keeps making
 * photos from them until the new set is saved. Free.
 */
export async function replacePhotosAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await guarded("replacePhotosAction", form, async (user) => {
    const avatar = await getAvatar(user.id, text(form, "id"));
    if (!avatar) throw new InvalidRequestError("That avatar is gone. Reload the page.");
    if (!identityLock(avatar)) throw new InvalidRequestError("She has no description yet. Finish her setup first.");
    const style = text(form, "style");
    if (!isPhotoStyle(style)) throw new InvalidRequestError("Pick a photo style.");

    /* One setup run per account. A run of this kind may be started again (she
       came back to it), but another avatar's setup that is still open must be
       finished first: starting here would replace its answers. */
    const open = await getSession(user.id);
    if (open && !open.completedAt && !open.ui.replacing) {
      throw new InvalidRequestError("Finish setting up your other avatar first, then come back to change these photos.");
    }

    await setSetupPhotosRetired(user.id, avatar.id, true);
    await beginSession(user.id, {
      stage: "photos",
      interview: start({ avatarKind: avatar.kind, personaName: avatar.name, niche: "New reference photos" }),
      ui: { avatarId: avatar.id, replacing: { style } },
    });
    await rememberAvatar(avatar.id);
    revalidatePath("/", "layout");
    return "Started.";
  });
  if (state?.ok) redirect(stagePath("photos"));
  return state;
}

/**
 * She changed her mind part-way through new photos. The photos added in this
 * run are deleted, the old set is switched back on, and the run is closed:
 * the avatar was never changed.
 */
export async function cancelReplacePhotosAction(): Promise<void> {
  const user = await requireUser();
  const session = await getSession(user.id);
  const avatarId = session?.ui.avatarId;
  if (session && !session.completedAt && session.ui.replacing && avatarId && (await getAvatar(user.id, avatarId))) {
    for (const photo of await listUploads(user.id, avatarId)) await deleteMedia(user.id, photo.id);
    await setSetupPhotosRetired(user.id, avatarId, false);
    await completeSession(user.id);
  }
  revalidatePath("/", "layout");
  redirect("/avatar");
}

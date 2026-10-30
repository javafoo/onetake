"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { stagePath } from "@/app/onboarding/flow";
import { checkAvatarDeletion, eraseAvatar } from "@/account/delete-avatar";
import { createAvatar, deleteAvatar, getAvatar, listAvatars, updateAvatar } from "@/data/avatars";
import { avatarPathnames } from "@/data/media";
import { beginSession, completeSession, getSession } from "@/data/onboarding";
import { getStorage } from "@/lib/get-storage";
import { type User } from "@/data/users";
import { guardedAction } from "@/lib/action-guard";
import { avatarAllowance, canAddAvatar } from "@/lib/avatar-allowance";
import { rememberAvatar } from "@/lib/current-avatar";
import { InvalidRequestError } from "@/lib/errors";
import { start } from "@/onboarding/state";

import type { ActionState } from "../actions";

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const MAX_NAME = 60;

function guarded(where: string, form: FormData, run: (user: User) => Promise<string>): Promise<ActionState> {
  return guardedAction<string, ActionState>(form, {
    where,
    run,
    done: (message) => ({ ok: true, message }),
    failed: (message) => ({ ok: false, message }),
  });
}

/** Every page is about one avatar at a time; this picks which. */
export async function switchAvatarAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await guarded("switchAvatarAction", form, async (user) => {
    const avatar = await getAvatar(user.id, text(form, "id"));
    if (!avatar) throw new InvalidRequestError("That avatar is gone. Reload the page.");
    await rememberAvatar(avatar.id);
    revalidatePath("/", "layout");
    return `Now working on ${avatar.name}.`;
  });
  if (state?.ok) redirect("/");
  return state;
}

export async function renameAvatarAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded("renameAvatarAction", form, async (user) => {
    const name = text(form, "name");
    if (!name) throw new InvalidRequestError("Give her a name.");
    if (name.length > MAX_NAME) throw new InvalidRequestError(`Keep the name under ${MAX_NAME} characters.`);
    const updated = await updateAvatar(user.id, text(form, "id"), { name });
    if (!updated) throw new InvalidRequestError("That avatar is gone. Reload the page.");
    revalidatePath("/", "layout");
    return "Renamed.";
  });
}

/**
 * Deletes one avatar and everything that is hers: photos, clips, reels,
 * carousels, her reference set, her brand, drafts and hooks. The account, its
 * credits and its other avatars stay. She types the name to confirm, because
 * nothing here can be undone.
 */
export async function deleteAvatarAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await guarded("deleteAvatarAction", form, async (user) => {
    const avatar = await getAvatar(user.id, text(form, "id"));
    if (!avatar) throw new InvalidRequestError("That avatar is already gone. Reload the page.");
    const avatars = await listAvatars(user.id);
    const check = checkAvatarDeletion({ name: avatar.name, typed: text(form, "confirm"), avatars: avatars.length });
    if (!check.ok) throw new InvalidRequestError(check.message);

    const storage = getStorage();
    await eraseAvatar(user.id, avatar.id, {
      pathnames: avatarPathnames,
      deleteObject: (pathname) => storage.delete(pathname),
      deleteRow: deleteAvatar,
    });

    /* A setup left open for her has nothing left to set up: closed, so the
       app does not send her back into it. */
    const session = await getSession(user.id);
    if (session && !session.completedAt && session.ui.avatarId === avatar.id) await completeSession(user.id);
    // The pages move to another avatar of hers; the cookie would fall back anyway, this says which.
    const next = avatars.find((other) => other.id !== avatar.id);
    if (next) await rememberAvatar(next.id);
    revalidatePath("/", "layout");
    return `${avatar.name} and everything of hers is deleted.`;
  });
  if (state?.ok) redirect("/avatars");
  return state;
}

/**
 * Another avatar. She is named and typed here, the way the first one was on
 * the welcome screen, and setup starts again at the photos: the same screens
 * make her reference set, her description and her brand. The allowance is
 * the plan's, checked on the server, and the new avatar becomes the current
 * one so the next page she opens is already hers.
 */
export async function newAvatarAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await guarded("newAvatarAction", form, async (user) => {
    const personaName = text(form, "personaName");
    const niche = text(form, "niche");
    const kind = text(form, "avatarKind");
    if (!personaName) throw new InvalidRequestError("Give her a name. It is the name on the account.");
    if (personaName.length > MAX_NAME) throw new InvalidRequestError(`Keep the name under ${MAX_NAME} characters.`);
    if (!niche) throw new InvalidRequestError("Say what the account is about, in one line.");
    if (kind !== "twin" && kind !== "avatar") throw new InvalidRequestError("Pick whose face this is.");

    const existing = await listAvatars(user.id);
    const allowance = avatarAllowance(user);
    if (!canAddAvatar(existing.length, allowance)) {
      throw new InvalidRequestError(
        allowance === 1
          ? "Your plan includes one avatar. The Pro plan includes three."
          : `Your plan includes ${allowance} avatars, and you have ${existing.length}.`,
      );
    }

    const avatar = await createAvatar(user.id, { name: personaName, kind });
    await beginSession(user.id, {
      stage: "photos",
      interview: start({ avatarKind: kind, personaName, niche }),
      ui: { avatarId: avatar.id },
    });
    await rememberAvatar(avatar.id);
    revalidatePath("/", "layout");
    return "Created.";
  });
  if (state?.ok) redirect(stagePath("photos"));
  return state;
}

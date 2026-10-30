/* Deleting one avatar and everything that is hers.
 *
 * The same order as erasing an account (see `delete.ts`), for the same reason:
 * the media rows are the only record of which stored objects are hers, so the
 * objects go first and the rows after. A crash in between leaves rows pointing
 * at nothing, which the next attempt finishes; the other order would leave
 * bytes nobody can find.
 *
 * The `avatars` row cascades to her media (photos, clips, reels, carousel
 * slides, reference and setup uploads), her reference set, her brand profile
 * and brief, her drafts, her saved hooks and her jobs. The account, its
 * credits and its other avatars are untouched.
 *
 * The last avatar is refused: every page is about one, and an account with
 * none has nowhere to go but setup. Leaving altogether is the Account page.
 *
 * Idempotent: a second call finds no avatar and says so. */

export type AvatarDeletionCheck = { ok: true } | { ok: false; message: string };

/** Whether she may delete this one, in a sentence she can act on when not. Pure. */
export function checkAvatarDeletion(input: { name: string; typed: string; avatars: number }): AvatarDeletionCheck {
  if (input.avatars <= 1) {
    return { ok: false, message: "This is your only avatar, so it cannot be deleted on its own. To delete everything, use Delete account on the Account page." };
  }
  const same = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
  if (same(input.typed) !== same(input.name)) {
    return { ok: false, message: `Type ${input.name} exactly to confirm.` };
  }
  return { ok: true };
}

export interface AvatarDeletionDeps {
  /** Every stored object of hers: the pathnames on her media rows. */
  pathnames(userId: string, avatarId: string): Promise<string[]>;
  deleteObject(pathname: string): Promise<void>;
  /** Delete the avatar row; the database cascades the rest. True when there was one. */
  deleteRow(userId: string, avatarId: string): Promise<boolean>;
}

export type AvatarDeletionResult = { existed: boolean; objects: number };

export async function eraseAvatar(userId: string, avatarId: string, deps: AvatarDeletionDeps): Promise<AvatarDeletionResult> {
  const pathnames = await deps.pathnames(userId, avatarId);
  /* A few at a time: a busy avatar holds hundreds of objects, and one slow
     delete should not hold up the rest nor all of them hit the store at once. */
  const queue = [...pathnames];
  const worker = async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) await deps.deleteObject(next);
  };
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker));
  const existed = await deps.deleteRow(userId, avatarId);
  return { existed, objects: pathnames.length };
}

import "server-only";

import { cookies } from "next/headers";

import { getAvatar, listAvatars, primaryAvatar, type Avatar } from "@/data/avatars";
import { isUuid } from "@/data/ids";
import type { User } from "@/data/users";

import { avatarAllowance } from "./avatar-allowance";

/* Which of her avatars a page is about.
 *
 * The choice is a cookie, per browser, not a column: switching on the phone
 * should not switch the laptop mid-edit, and nothing that runs outside a
 * request (a job, the agent's steps) may depend on it — those carry the avatar
 * id on the job row. The cookie is only ever a hint: it is checked against the
 * account's own rows, so a stale or borrowed id falls back to the first avatar,
 * exactly what every page showed before there could be more than one. */

export const AVATAR_COOKIE = "avatar";
const ONE_YEAR = 60 * 60 * 24 * 365;

export async function currentAvatar(userId: string): Promise<Avatar | null> {
  const chosen = (await cookies()).get(AVATAR_COOKIE)?.value ?? "";
  if (isUuid(chosen)) {
    const avatar = await getAvatar(userId, chosen);
    if (avatar) return avatar;
  }
  return primaryAvatar(userId);
}

/** Whether switching is a thing for this account: more than one avatar, or a
    plan that sells more than one. A one-avatar plan sees no switcher at all. */
export async function canSwitchAvatars(user: User): Promise<boolean> {
  if (avatarAllowance(user) > 1) return true;
  return (await listAvatars(user.id)).length > 1;
}

/** Only a server action or route handler may call this: pages cannot set cookies. */
export async function rememberAvatar(avatarId: string): Promise<void> {
  (await cookies()).set(AVATAR_COOKIE, avatarId, { path: "/", httpOnly: true, sameSite: "lax", maxAge: ONE_YEAR });
}

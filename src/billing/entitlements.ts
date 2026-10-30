/* What a user is allowed to do. There are no plans: every account may
   generate, and what it can spend is capped by its credits (`credits.ts`).
   Kept as its own module so the job layer asks one question in one place. */

import type { UserBillingRow } from "./store";

/** Avatars any one account may have. */
export const MAX_AVATARS = 3;

/** The fields of the `users` row this module reads. */
export type EntitlementUser = Pick<UserBillingRow, "id">;

export interface Entitlements {
  /** The library, drafts and settings are readable. */
  active: boolean;
  /** How many avatars the account may have. */
  avatarsAllowed: number;
  /** New generation is allowed. */
  canGenerate: boolean;
}

export function getEntitlements(user: EntitlementUser): Entitlements {
  void user;
  return { active: true, avatarsAllowed: MAX_AVATARS, canGenerate: true };
}

/** The entitlements of a user who may start new generation; every account may. */
export function requireCanGenerate(user: EntitlementUser): Entitlements {
  return getEntitlements(user);
}

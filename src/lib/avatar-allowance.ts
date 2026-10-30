/* How many avatars an account may have: the same for every account, and
   never fewer than the one setup makes. Pure, so the rule can be tested
   without a database. */

import { getEntitlements, type EntitlementUser } from "@/billing/entitlements";

export function avatarAllowance(user: EntitlementUser): number {
  return Math.max(1, getEntitlements(user).avatarsAllowed);
}

export function canAddAvatar(count: number, allowance: number): boolean {
  return count < allowance;
}

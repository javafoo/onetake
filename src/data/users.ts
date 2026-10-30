import { auth, clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { ensureFreeCredits } from "@/billing/credits";
import { db, schema } from "@/db/client";

export type User = typeof schema.users.$inferSelect;

export async function getUser(userId: string): Promise<User | null> {
  const [row] = await db().select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return row ?? null;
}

/** Idempotent: safe to call on every request and from the import scripts. */
export async function ensureUser(userId: string, email: string): Promise<User> {
  const [row] = await db()
    .insert(schema.users)
    .values({ id: userId, email })
    .onConflictDoUpdate({ target: schema.users.id, set: { email, updatedAt: new Date() } })
    .returning();
  return row;
}

export async function deleteUser(userId: string): Promise<void> {
  await db().delete(schema.users).where(eq(schema.users.id, userId));
}

/**
 * Whether Clerk says this account's primary email address is confirmed.
 *
 * Asked of Clerk rather than stored here. Verification is Clerk's fact and it
 * changes without telling us, so a column in this table would be a copy that
 * is stale exactly when it matters — just after she has clicked the link and
 * come back to see whether her free photo is still waiting.
 *
 * An account with no primary address falls back to the first one it has, the
 * same way `requireUser` picks the address it stores. A Clerk outage answers
 * false: what is gated on this is a gift and the free model calls, and not
 * giving those away during an outage is the safe direction to fail.
 *
 * A "yes" is remembered for a few minutes, because every free model call on
 * an account with no plan asks (`src/lib/email-gate.ts`) and a verified
 * address does not become unverified. A "no" is never remembered: she should
 * be let through the moment she has clicked the link.
 */
const VERIFIED_REMEMBER_MS = 5 * 60_000;
const verifiedAt = new Map<string, number>();

export async function hasVerifiedEmail(userId: string): Promise<boolean> {
  const seen = verifiedAt.get(userId);
  if (seen !== undefined && Date.now() - seen < VERIFIED_REMEMBER_MS) return true;
  try {
    const person = await (await clerkClient()).users.getUser(userId);
    const address = person.primaryEmailAddress ?? person.emailAddresses[0] ?? null;
    const verified = address?.verification?.status === "verified";
    if (verified) verifiedAt.set(userId, Date.now());
    return verified;
  } catch (error) {
    console.error("users: could not read email verification from Clerk —", error instanceof Error ? error.message : error);
    return false;
  }
}

/* Accounts live in Clerk; this table holds the rows everything else points at.
   Rather than a webhook that can be missed or replayed, the row is written the
   first time a signed-in user is seen, which is also the first time it matters. */
export async function requireUser(): Promise<User> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");

  const existing = await getUser(userId);
  if (existing) return existing;

  const person = await (await clerkClient()).users.getUser(userId);
  const email = person.primaryEmailAddress?.emailAddress ?? person.emailAddresses[0]?.emailAddress ?? "";
  const user = await ensureUser(userId, email);
  // A new account starts with its free credits. Idempotent, and the pages that show a balance grant it too.
  await ensureFreeCredits(userId);
  return user;
}

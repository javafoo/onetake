import { sql } from "drizzle-orm";

import { db } from "@/db/client";

/* The one free photo, and the only place that decides who still has it.
 *
 * Every account gets exactly one free photo for its lifetime. That is a real
 * promise in both directions: she should get it without a card, and she should
 * not be able to get two. The second half is the hard one, because "check, then
 * generate" is two round trips and a second tap fits comfortably between them.
 *
 * So there is no check. `claimFreePhoto` is a single conditional UPDATE — set
 * the column only while it is still null — and Postgres answers with the row it
 * changed or with nothing at all. Of two concurrent claims exactly one gets a
 * row back; the other is told no and never reaches the job. The Neon HTTP
 * driver has no interactive transactions, which rules out the read-then-write
 * shape anyway, and here that limitation costs nothing: one statement is both
 * the check and the claim.
 *
 * The claim happens BEFORE the job is created, so the failure mode is losing a
 * freebie rather than giving away two. `releaseFreePhoto` puts it back when the
 * job it was claimed for never delivered a photo.
 */

/** What an account's freebie is worth knowing about, for a page. */
export interface FreebieState {
  /** True while the free photo is still available. */
  available: boolean;
  usedAt: Date | null;
}

export async function freePhotoState(userId: string): Promise<FreebieState> {
  const { rows } = await db().execute<{ free_photo_used_at: string | null }>(sql`
    select free_photo_used_at from users where id = ${userId} limit 1
  `);
  if (rows.length === 0) return { available: false, usedAt: null };
  const usedAt = rows[0].free_photo_used_at;
  return { available: usedAt === null, usedAt: usedAt === null ? null : new Date(usedAt) };
}

/**
 * Take this account's free photo, or say it has already gone.
 *
 * Returns the moment it was claimed, which the caller hands to
 * `releaseFreePhoto` if the work it was claimed for does not happen. Two
 * simultaneous calls cannot both return a timestamp.
 */
export async function claimFreePhoto(userId: string, at: Date = new Date()): Promise<Date | null> {
  const { rows } = await db().execute<{ free_photo_used_at: string }>(sql`
    update users
    set free_photo_used_at = ${at.toISOString()}::timestamptz, updated_at = now()
    where id = ${userId} and free_photo_used_at is null
    returning free_photo_used_at
  `);
  return rows.length > 0 ? new Date(rows[0].free_photo_used_at) : null;
}

/**
 * Give the freebie back.
 *
 * Conditional on the exact timestamp this caller claimed, which is what stops
 * it from undoing somebody else's claim: if the column has moved on — because
 * the freebie was released and claimed again since — this matches nothing and
 * writes nothing. Returns true if the freebie is now available again.
 */
export async function releaseFreePhoto(userId: string, claimedAt: Date): Promise<boolean> {
  const { rows } = await db().execute<{ id: string }>(sql`
    update users set free_photo_used_at = null, updated_at = now()
    where id = ${userId} and free_photo_used_at = ${claimedAt.toISOString()}::timestamptz
    returning id
  `);
  return rows.length > 0;
}

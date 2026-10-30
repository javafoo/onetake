import { sql } from "drizzle-orm";

import { db, schema } from "@/db/client";
import { UserFacingError } from "@/lib/errors";

import type { RefusalReason, ScreenVerdict } from "./verdict";

/* The record an operator reads, and the error a caller throws.
 *
 * What goes in the table: who, which check, which category, when. What never
 * goes in it: the photograph, the prompt, or a description of either. A
 * refusal record that holds the thing it refused is a copy of exactly the
 * material we did not want to keep, and it would be the most sensitive row in
 * the database.
 */

export type RefusalStage = "upload" | "generation" | "scene_idea";

/** A refusal the person reads as written. Never says what the model saw. */
export class SafetyRefusalError extends UserFacingError {
  readonly reason: RefusalReason;

  constructor(reason: RefusalReason, message: string) {
    super(message);
    this.name = "SafetyRefusalError";
    this.reason = reason;
  }
}

/** Write the refusal down. Never throws: failing to record must not un-refuse. */
export async function recordRefusal(userId: string, stage: RefusalStage, reason: RefusalReason): Promise<void> {
  try {
    await db().insert(schema.safetyRefusals).values({ userId, stage, reason });
  } catch (error) {
    console.error("safety: could not record a refusal —", error instanceof Error ? error.message : error);
  }
}

/** Record it and throw it, which is what every caller that refuses wants. */
export async function refuse(userId: string, stage: RefusalStage, verdict: ScreenVerdict): Promise<never> {
  if (verdict.ok) throw new Error("refuse() was called with a verdict that allowed the request");
  await recordRefusal(userId, stage, verdict.reason);
  throw new SafetyRefusalError(verdict.reason, verdict.message);
}

/** Refusals in the last day, by category. For the operator, not for a page. */
export async function refusalSummary(sinceHours = 24): Promise<{ reason: string; stage: string; count: number }[]> {
  const { rows } = await db().execute<{ reason: string; stage: string; count: number }>(sql`
    select reason, stage, count(*)::int as count
    from safety_refusals
    where created_at >= now() - make_interval(hours => ${sinceHours})
    group by reason, stage
    order by count desc
  `);
  return rows.map((row) => ({ reason: row.reason, stage: row.stage, count: Number(row.count) }));
}

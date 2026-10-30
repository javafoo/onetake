import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import { UserFacingError } from "./errors";
import {
  allowanceFor,
  BURST,
  LIMITS,
  limitMessage,
  retryAfterMs,
  windowStart,
  type LimitName,
  type LimitRule,
} from "./limits";

/* The counters, in Postgres.
 *
 * In memory would be simpler and wrong: a serverless function is many
 * processes, none of which outlive a request, so an in-process counter limits
 * one instance and lets the next one start again from zero.
 *
 * Counting is one statement. The Neon HTTP driver has no interactive
 * transactions, so "read the count, decide, write it back" cannot be made safe
 * in application code — and a rate limiter that can be raced is not one. The
 * upsert below tests the condition and does the increment in the same
 * statement:
 *
 *   insert ... values (…, 1)
 *   on conflict (user_id, bucket, window_start)
 *   do update set count = rate_limits.count + 1 where rate_limits.count < cap
 *   returning count
 *
 * The insert plants the first request of a window. Every later one conflicts,
 * and the conditional UPDATE either lands — under the cap, one more counted —
 * or matches nothing, which comes back as no rows and means "over". Postgres
 * takes a row lock for the conflict, so concurrent callers are serialised and
 * each of them sees the previous count.
 */

/** A refusal that says when the person can try again. Message shown as written. */
export class RateLimitedError extends UserFacingError {
  readonly bucket: string;
  readonly retryAfterMs: number;

  constructor(message: string, bucket: string, retryAfterMs: number) {
    super(message);
    this.name = "RateLimitedError";
    this.bucket = bucket;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Rows are kept a little past their window so a clock skew cannot resurrect one. */
const KEEP_AFTER_WINDOW_MS = 60_000;

export interface ConsumeResult {
  allowed: boolean;
  /** How many are left in this window after this call. */
  remaining: number;
  retryAfterMs: number;
}

/**
 * Count one use of `rule` for `userId`, or say it is over.
 *
 * `cost` lets one call count as several, which is how an action that makes
 * fifteen vision calls is charged fifteen rather than one.
 */
export async function consume(
  userId: string,
  rule: LimitRule,
  allowance: number,
  options: { now?: Date; cost?: number } = {},
): Promise<ConsumeResult> {
  const now = options.now ?? new Date();
  const cost = Math.max(1, Math.round(options.cost ?? 1));
  const start = windowStart(now, rule.windowMs);
  const expires = new Date(start.getTime() + rule.windowMs + KEEP_AFTER_WINDOW_MS);
  const retry = retryAfterMs(now, rule.windowMs);

  if (allowance <= 0) return { allowed: false, remaining: 0, retryAfterMs: retry };

  const { rows } = await db().execute<{ count: number }>(sql`
    insert into rate_limits (user_id, bucket, window_start, count, expires_at, updated_at)
    values (${userId}, ${rule.bucket}, ${start.toISOString()}::timestamptz, ${cost},
            ${expires.toISOString()}::timestamptz, now())
    on conflict (user_id, bucket, window_start) do update
      set count = rate_limits.count + ${cost}, updated_at = now()
      where rate_limits.count + ${cost} <= ${allowance}
    returning count
  `);

  const count = rows.length > 0 ? Number(rows[0].count) : allowance;
  /* The insert branch has no condition of its own, so a first call whose cost
     is larger than the whole allowance has to be caught here. */
  if (rows.length === 0 || count > allowance) {
    if (rows.length > 0) await release(userId, rule, start, cost);
    return { allowed: false, remaining: 0, retryAfterMs: retry };
  }
  return { allowed: true, remaining: Math.max(0, allowance - count), retryAfterMs: retry };
}

/** Give a counted use back. Used when a later check in the same call refuses, or when what was counted then failed to start. */
export async function release(userId: string, rule: LimitRule, start: Date, cost: number): Promise<void> {
  await db().execute(sql`
    update rate_limits set count = greatest(0, count - ${cost})
    where user_id = ${userId} and bucket = ${rule.bucket} and window_start = ${start.toISOString()}::timestamptz
  `);
}

/** Enough of the `users` row to count against. */
export interface LimitedUser {
  id: string;
}

/* Every account gets the larger allowance: there are no plans, and what an
   account can spend is capped by its free credits, not by these counters. */
const FULL_ALLOWANCE = true;

/**
 * Take one from the burst allowance and one from the named limit, or throw.
 *
 * The burst rule is checked first and given back if the named limit refuses,
 * so being refused does not itself use up the short allowance.
 */
export async function requireWithinLimit(
  user: LimitedUser,
  name: LimitName,
  options: { now?: Date; cost?: number } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  const plan = FULL_ALLOWANCE;

  const burst = await consume(user.id, BURST, allowanceFor(BURST, plan), { now });
  if (!burst.allowed) {
    throw new RateLimitedError(
      limitMessage(BURST, allowanceFor(BURST, plan), burst.retryAfterMs, plan),
      BURST.bucket,
      burst.retryAfterMs,
    );
  }

  const rule = LIMITS[name];
  const allowance = allowanceFor(rule, plan);
  const result = await consume(user.id, rule, allowance, { now, cost: options.cost });
  if (!result.allowed) {
    await release(user.id, BURST, windowStart(now, BURST.windowMs), 1);
    throw new RateLimitedError(
      limitMessage(rule, allowance, result.retryAfterMs, plan),
      rule.bucket,
      result.retryAfterMs,
    );
  }
}

/** How much of `rule` this user has used in the window `now` falls in. Zero when nothing was counted. */
export async function countUsed(userId: string, rule: LimitRule, now: Date = new Date()): Promise<number> {
  const start = windowStart(now, rule.windowMs);
  const { rows } = await db().execute<{ count: number }>(sql`
    select count from rate_limits
    where user_id = ${userId} and bucket = ${rule.bucket} and window_start = ${start.toISOString()}::timestamptz
  `);
  return rows.length > 0 ? Number(rows[0].count) : 0;
}

/** Drop rows whose window is long gone. Cheap, and safe to call from anywhere. */
export async function sweepRateLimits(now: Date = new Date()): Promise<number> {
  const { rows } = await db().execute<{ id: string }>(sql`
    delete from rate_limits where expires_at < ${now.toISOString()}::timestamptz returning user_id as id
  `);
  return rows.length;
}

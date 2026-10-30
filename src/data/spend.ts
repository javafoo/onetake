import { sql } from "drizzle-orm";

import { db } from "@/db/client";

/* `provider_costs`, and the daily cap that is read from it.
 *
 * The cap used to be read-then-write: `spentTodayUsd()` and then, separately,
 * `recordCost()`. Nothing sat between the two, so a hundred concurrent starts
 * all read the same total, all found room, and all spent. The check and the
 * row are now one statement, behind the transaction-scoped advisory lock the
 * comment at the top of `src/billing/store.db.ts` explains — the only shape
 * available, because the Neon HTTP driver has no interactive transactions.
 * The lock is global rather than per user on purpose: the cap is global, so
 * that is the thing two callers have to queue for.
 */

/** Everything under this key is queueing for the same number. */
const CAP_LOCK = "provider_costs:daily_cap";

export interface SpendEntry {
  userId: string | null;
  /** Null for a model call that is not part of a job: hook writing, setup, screening. */
  jobId?: string | null;
  provider: string;
  model: string;
  /** What this was for: a job kind, or a named action shape. */
  kind: string;
  costUsd: number;
  meta?: Record<string, unknown>;
}

export type ReserveSpendResult =
  | { ok: true; id: string }
  | { ok: false; spentUsd: number };

/**
 * Hold `costUsd` against today's cap and write the `reserved` row, atomically.
 *
 * `{ ok: false }` means the cap would have been passed and nothing was
 * written, so a refused attempt costs nobody anything — not the caller, and
 * not the next caller's allowance.
 */
export async function reserveSpend(entry: SpendEntry, capUsd: number): Promise<ReserveSpendResult> {
  const cost = entry.costUsd.toFixed(4);
  const [, inserted] = await db().batch([
    db().execute(sql`select pg_advisory_xact_lock(hashtextextended(${CAP_LOCK}, 0))`),
    db().execute<{ id: string }>(sql`
      insert into provider_costs (user_id, job_id, provider, model, kind, cost_usd, status, meta)
      select ${entry.userId}, ${entry.jobId ?? null}::uuid, ${entry.provider}, ${entry.model}, ${entry.kind},
             ${cost}::numeric, 'reserved', ${JSON.stringify(entry.meta ?? {})}::jsonb
      where (
        select coalesce(sum(cost_usd), 0) from provider_costs
        where created_at >= date_trunc('day', now() at time zone 'utc')
          and (status = 'done' or (status = 'reserved' and created_at > now() - interval '1 hour'))
      ) + ${cost}::numeric <= ${capUsd}::numeric
      returning id
    `),
  ]);

  if (inserted.rows.length > 0) return { ok: true, id: String(inserted.rows[0].id) };
  return { ok: false, spentUsd: await spentTodayUsd() };
}

/**
 * Replace the estimate with what the call really cost, once it is over.
 *
 * `costUsd` is left out when the provider told us nothing useful, in which
 * case the estimate stands: a reserved row that is never settled would go on
 * counting against the cap forever, and a made-up figure is worse than a
 * generous one.
 */
export async function settleSpend(
  id: string,
  input: { status: "done" | "refunded"; costUsd?: number; meta?: Record<string, unknown> },
): Promise<void> {
  const cost = input.costUsd === undefined ? null : input.costUsd.toFixed(4);
  await db().execute(sql`
    update provider_costs
    set status = ${input.status},
        cost_usd = coalesce(${cost}::numeric, cost_usd),
        meta = meta || ${JSON.stringify(input.meta ?? {})}::jsonb
    where id = ${id}::uuid and status = 'reserved'
  `);
}

/* A reservation that was never settled (a crashed worker, a test that gave up)
   would otherwise hold its dollars against the cap forever. After an hour, far
   longer than any call is allowed to run, it is treated as abandoned. */
export async function releaseStaleReservations(): Promise<number> {
  const result = await db().execute<{ id: string }>(sql`
    update provider_costs set status = 'refunded', meta = meta || '{"abandoned":true}'::jsonb
    where status = 'reserved' and created_at < now() - interval '1 hour'
    returning id`);
  return result.rows.length;
}

/** Everything we have spent today across all users, in dollars. Refunded and abandoned rows do not count. */
export async function spentTodayUsd(): Promise<number> {
  const result = await db().execute<{ spent: number }>(sql`
    select coalesce(sum(cost_usd), 0)::float8 as spent
    from provider_costs
    where created_at >= date_trunc('day', now() at time zone 'utc')
      and (status = 'done' or (status = 'reserved' and created_at > now() - interval '1 hour'))
  `);
  return Number(result.rows[0]?.spent ?? 0);
}

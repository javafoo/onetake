/* The Postgres implementation of the billing store.

   Why the odd-looking `db().batch([lock, statement])` shape below: the Neon HTTP
   driver has no interactive transactions (drizzle throws "No transactions
   support in neon-http driver"), so read-then-write in application code cannot
   be made safe by wrapping it. `batch` does give us one real transaction per
   call, and under READ COMMITTED each statement in it takes a fresh snapshot.
   So the first statement takes a transaction-scoped advisory lock keyed on the
   user (or the job), and the second statement — which both tests the condition
   and writes the row — runs with a snapshot taken after that lock was granted,
   and therefore sees every reservation that committed before us. Two concurrent
   reservations are serialised by the lock and the loser sees the winner's row,
   so the balance can never go negative. `grant` takes the same lock, so the
   free grant's note check and its insert see the same ledger. */

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db, schema } from "@/db/client";

import type { Movement, MovementJobKind } from "./history";
import type { BillingStore, CreditStore, LedgerRow, ReserveResult, UserBillingRow, UserStore } from "./store";

/** Namespaced so two different locks in this file can never collide. */
function lock(key: string) {
  return db().execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

function rowCount(result: { rows: unknown[] }): number {
  return result.rows.length;
}

function toLedgerRow(row: typeof schema.creditLedger.$inferSelect): LedgerRow {
  return {
    id: row.id,
    userId: row.userId,
    delta: row.delta,
    reason: row.reason,
    jobId: row.jobId,
    note: row.note,
    createdAt: row.createdAt,
  };
}

function toUserRow(row: typeof schema.users.$inferSelect): UserBillingRow {
  return {
    id: row.id,
    email: row.email,
  };
}

export const dbCreditStore: CreditStore = {
  async balance(userId) {
    const result = await db().execute<{ balance: number }>(
      sql`select coalesce(sum(delta), 0)::int as balance from credit_ledger where user_id = ${userId}`,
    );
    return Number(result.rows[0]?.balance ?? 0);
  },

  async ledger(userId) {
    const rows = await db()
      .select()
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.userId, userId))
      .orderBy(asc(schema.creditLedger.createdAt), asc(schema.creditLedger.id));
    return rows.map(toLedgerRow);
  },

  async tryReserve({ userId, credits, jobId, note }): Promise<ReserveResult> {
    const [, inserted, after] = await db().batch([
      lock(`credits:${userId}`),
      db().execute(sql`
        insert into credit_ledger (user_id, delta, reason, job_id, note)
        select ${userId}, ${-credits}, 'job_reserve', ${jobId}::uuid, ${note ?? null}
        where (select coalesce(sum(delta), 0) from credit_ledger where user_id = ${userId}) >= ${credits}
        returning id
      `),
      db().execute<{ balance: number }>(
        sql`select coalesce(sum(delta), 0)::int as balance from credit_ledger where user_id = ${userId}`,
      ),
    ]);
    return { reserved: rowCount(inserted) > 0, balance: Number(after.rows[0]?.balance ?? 0) };
  },

  async refundJob({ jobId, note }) {
    const [, inserted] = await db().batch([
      lock(`job:${jobId}`),
      db().execute<{ delta: number }>(sql`
        insert into credit_ledger (user_id, delta, reason, job_id, note)
        select r.user_id, -sum(r.delta), 'job_refund', ${jobId}::uuid, ${note ?? null}
        from credit_ledger r
        where r.job_id = ${jobId}::uuid and r.reason = 'job_reserve'
        group by r.user_id
        having sum(r.delta) < 0
          and not exists (
            select 1 from credit_ledger f where f.job_id = ${jobId}::uuid and f.reason = 'job_refund'
          )
          -- A completed job delivered an output the user keeps, so its credits
          -- are spent whatever the caller believes. fail() in src/jobs/index.ts
          -- also refuses to call this after a lost race; this is the copy that
          -- holds when two workers interleave, because it runs inside the
          -- advisory lock and reads the jobs row as it is at that moment.
          and not exists (
            select 1 from jobs j where j.id = ${jobId}::uuid and j.status = 'completed'
          )
        returning delta
      `),
    ]);
    return Number(inserted.rows[0]?.delta ?? 0);
  },

  async grant({ userId, credits, reason, note }) {
    const dedupeNote = note ?? null;
    const [, inserted] = await db().batch([
      lock(`credits:${userId}`),
      db().execute(sql`
        insert into credit_ledger (user_id, delta, reason, note)
        select ${userId}, ${credits}, ${reason}, ${dedupeNote}
        where not exists (
          select 1 from credit_ledger existing
          where existing.user_id = ${userId}
            and ${dedupeNote}::text is not null and existing.reason = ${reason} and existing.note = ${dedupeNote}::text
        )
        returning id
      `),
    ]);
    return rowCount(inserted) > 0;
  },
};

export const dbUserStore: UserStore = {
  async find(userId) {
    const rows = await db().select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    return rows[0] ? toUserRow(rows[0]) : null;
  },

  async ensure({ id, email }) {
    await db().insert(schema.users).values({ id, email }).onConflictDoNothing({ target: schema.users.id });
    const row = await dbUserStore.find(id);
    if (!row) throw new Error(`Could not create the billing record for user ${id}`);
    return row;
  },
};

export const dbBillingStore: BillingStore = { credits: dbCreditStore, users: dbUserStore };

const MOVEMENT_KINDS: ReadonlySet<string> = new Set<MovementJobKind>(["image", "clip", "reel", "carousel"]);

/**
 * The most recent credit movements for one user, newest first, each carrying
 * the kind of job it paid for so `history.ts` can say "Photo" rather than
 * "job_reserve". Scoped to the user on both tables: the join is on a job id
 * that came from this user's ledger, and it is checked against the job's owner
 * anyway, because a tenancy check that is only implied is not a check.
 */
export async function recentMovements(userId: string, limit = 20): Promise<Movement[]> {
  const rows = await db()
    .select({
      id: schema.creditLedger.id,
      delta: schema.creditLedger.delta,
      reason: schema.creditLedger.reason,
      createdAt: schema.creditLedger.createdAt,
      jobKind: schema.jobs.kind,
    })
    .from(schema.creditLedger)
    .leftJoin(
      schema.jobs,
      and(eq(schema.creditLedger.jobId, schema.jobs.id), eq(schema.jobs.userId, userId)),
    )
    .where(eq(schema.creditLedger.userId, userId))
    .orderBy(desc(schema.creditLedger.createdAt), desc(schema.creditLedger.id))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    delta: row.delta,
    reason: row.reason,
    createdAt: row.createdAt,
    jobKind: row.jobKind && MOVEMENT_KINDS.has(row.jobKind) ? (row.jobKind as MovementJobKind) : null,
  }));
}

/** Used by the database-backed tests to check whether the migrations have run. */
export async function billingTablesExist(): Promise<boolean> {
  const result = await db().execute<{ present: number }>(sql`
    select count(*)::int as present from information_schema.tables
    where table_schema = 'public' and table_name in ('users', 'jobs', 'credit_ledger')
  `);
  return Number(result.rows[0]?.present ?? 0) === 3;
}

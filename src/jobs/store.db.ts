import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db, schema } from "@/db/client";
import { reserveSpend, spentTodayUsd } from "@/data/spend";

import type { CostEntry, CreateJobInput, CreateJobResult, JobCredits, JobStore, TransitionInput } from "./store";
import type { JobKind, JobOutput, JobRecord, JobStatus, StoredJobInput } from "./types";

/* The Postgres implementation of the job store.

   Two guarantees are bought with SQL rather than with application logic,
   because the Neon HTTP driver has no interactive transactions:

   1. `create` relies on the unique index on (user_id, request_id). A second
      delivery of the same submission inserts nothing and reads the first row.
   2. `transition` is a single conditional UPDATE. Two polls that read the same
      row send the same `updated_at`; only one UPDATE matches, so only one of
      them does the work and stores an output.

   Every write stamps `updated_at` from the application clock. Postgres keeps
   microseconds and the driver hands back milliseconds, so a value written by
   `now()` could never be compared for equality after a round trip. */

type Row = typeof schema.jobs.$inferSelect;

export function toRecord(row: Row): JobRecord {
  return {
    id: row.id,
    userId: row.userId,
    avatarId: row.avatarId,
    kind: row.kind as JobKind,
    status: row.status as JobStatus,
    requestId: row.requestId,
    provider: row.provider,
    providerRequestId: row.providerRequestId,
    input: row.input as StoredJobInput,
    output: (row.output ?? null) as JobOutput | null,
    error: row.error,
    credits: row.credits,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The kind as the schema types it. `jobs.kind` is a plain text column; the
 * list of kinds in `src/db/schema.ts` is TypeScript only, and "stories" was
 * added after it. The cast goes once the schema's list names it.
 */
export function rowKind(kind: JobKind): Row["kind"] {
  return kind as Row["kind"];
}

export const dbJobStore: JobStore = {
  async create(input: CreateJobInput): Promise<CreateJobResult> {
    const stamp = new Date();
    const [inserted] = await db()
      .insert(schema.jobs)
      .values({
        userId: input.userId,
        avatarId: input.avatarId,
        kind: rowKind(input.kind),
        requestId: input.requestId,
        input: input.input,
        credits: input.credits,
        status: "queued",
        createdAt: stamp,
        updatedAt: stamp,
      })
      .onConflictDoNothing({ target: [schema.jobs.userId, schema.jobs.requestId] })
      .returning();
    if (inserted) return { job: toRecord(inserted), created: true };

    const existing = await dbJobStore.findByRequest(input.userId, input.requestId);
    if (!existing) throw new Error("The job could not be created and no earlier one was found");
    return { job: existing, created: false };
  },

  async find(userId, jobId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) return null;
    const [row] = await db()
      .select()
      .from(schema.jobs)
      .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.userId, userId)))
      .limit(1);
    return row ? toRecord(row) : null;
  },

  async findByRequest(userId, requestId) {
    const [row] = await db()
      .select()
      .from(schema.jobs)
      .where(and(eq(schema.jobs.userId, userId), eq(schema.jobs.requestId, requestId)))
      .limit(1);
    return row ? toRecord(row) : null;
  },

  async transition({ userId, jobId, from, expectedUpdatedAt, requireNoOutput, patch }: TransitionInput) {
    const conditions = [
      eq(schema.jobs.id, jobId),
      eq(schema.jobs.userId, userId),
      inArray(schema.jobs.status, [...from]),
      ...(expectedUpdatedAt ? [eq(schema.jobs.updatedAt, expectedUpdatedAt)] : []),
      ...(requireNoOutput ? [isNull(schema.jobs.output)] : []),
    ];
    const [row] = await db()
      .update(schema.jobs)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return row ? toRecord(row) : null;
  },

  async remove(userId, jobId) {
    await db().delete(schema.jobs).where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.userId, userId)));
  },

  async credits(jobId): Promise<JobCredits> {
    const result = await db().execute<{ reserved: number; refunded: number }>(sql`
      select
        coalesce(-sum(delta) filter (where reason = 'job_reserve'), 0)::int as reserved,
        coalesce(sum(delta) filter (where reason = 'job_refund'), 0)::int as refunded
      from credit_ledger where job_id = ${jobId}::uuid
    `);
    const row = result.rows[0];
    return { reserved: Number(row?.reserved ?? 0), refunded: Number(row?.refunded ?? 0) };
  },

  async reserveCost(entry: CostEntry, capUsd: number) {
    const result = await reserveSpend(entry, capUsd);
    return result.ok ? ({ ok: true } as const) : ({ ok: false, spentUsd: result.spentUsd } as const);
  },

  async settleCost({ jobId, status, costUsd, meta }) {
    await db()
      .update(schema.providerCosts)
      .set({
        status,
        ...(costUsd === undefined ? {} : { costUsd: costUsd.toFixed(4) }),
        meta: sql`${schema.providerCosts.meta} || ${JSON.stringify(meta ?? {})}::jsonb`,
      })
      .where(and(eq(schema.providerCosts.jobId, jobId), eq(schema.providerCosts.status, "reserved")));
  },

  // The day is UTC, and so is the reset. A refunded call cost us nothing.
  spentTodayUsd,
};

/** Used by the database-backed tests to check whether the migrations have run. */
export async function jobTablesExist(): Promise<boolean> {
  const result = await db().execute<{ present: number }>(sql`
    select count(*)::int as present from information_schema.tables
    where table_schema = 'public' and table_name in ('jobs', 'provider_costs', 'credit_ledger')
  `);
  return Number(result.rows[0]?.present ?? 0) === 3;
}

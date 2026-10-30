import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";

import { db, schema } from "@/db/client";
import { rowKind } from "@/jobs/store.db";
import { SWEEP_LIMIT, SWEPT_WHEN_IDLE, SWEPT_WHEN_STUCK, sweepCutoffs, type SweepRow } from "@/jobs/sweep";
import type { JobKind } from "@/jobs/types";

/* The one query behind the every-minute job sweep (`/api/cron/jobs`).

   This is a cross-tenant read, like the retention sweep's queries in
   `retention.ts`, the email cron's in `src/email/queries.ts` and the operator
   pages' in `src/ops/`: a cron is not anybody's request, and the point is to
   find the jobs of people who are not here. It is kept as narrow as that
   allows. It returns who, which job and what kind, and nothing of
   what the job holds; it writes nothing; and everything the sweep then does
   with a row goes through the ordinary polls with that row's own user id, so
   each step is scoped to the owner exactly as her own browser's poll is.
   `userId` narrows it to one account, so the test can run it against a
   throwaway user without reading anybody else's rows.

   The rules (which kinds, after how long, what counts as top level) are
   `src/jobs/sweep.ts`; `isDue` and `isTopLevel` there are the same rules in
   TypeScript, and the database test holds the two to each other. */

/**
 * Unfinished top-level jobs nobody has touched lately, oldest first.
 *
 * Top level is no colon in `request_id` (a child is `<run>:<step>:<i>`).
 */
export async function sweepCandidates(now: Date, options: { limit?: number; userId?: string } = {}): Promise<SweepRow[]> {
  const { idle, stuck } = sweepCutoffs(now);
  const jobs = schema.jobs;
  const rows = await db()
    .select({ userId: jobs.userId, jobId: jobs.id, kind: jobs.kind })
    .from(jobs)
    .where(
      and(
        inArray(jobs.status, ["queued", "running"]),
        or(
          and(inArray(jobs.kind, SWEPT_WHEN_IDLE.map(rowKind)), lt(jobs.updatedAt, idle)),
          and(inArray(jobs.kind, SWEPT_WHEN_STUCK.map(rowKind)), lt(jobs.updatedAt, stuck)),
        ),
        sql`strpos(${jobs.requestId}, ':') = 0`,
        options.userId ? eq(jobs.userId, options.userId) : undefined,
      ),
    )
    .orderBy(asc(jobs.updatedAt))
    .limit(options.limit ?? SWEEP_LIMIT);

  return rows.map((row) => ({ userId: row.userId, jobId: row.jobId, kind: row.kind as JobKind }));
}

/* The sweep's one query against the real database: it takes unfinished
 * top-level jobs left alone long enough, oldest first, up to the limit, and
 * nothing else. The rules are the pure ones in `src/jobs/sweep.ts`; this holds
 * the SQL to them.
 *
 * It skips itself when there is no DATABASE_URL or the tables are not
 * migrated. It writes only jobs of one throwaway `test_sweep_<uuid>` user,
 * asks the query about that user alone (so nobody else's rows are read), and
 * deletes the user afterwards, which cascades to the jobs. No job here is
 * reserved or charged, so nothing lands in `provider_costs` or the ledger.
 *
 *   pnpm exec tsx --env-file=.env.local --test src/data/sweep.db.test.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import type { JobKind, JobStatus, StoredJobInput } from "@/jobs/types";
import { isDue, isTopLevel, SWEEP_IDLE_MS } from "@/jobs/sweep";

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

const MINUTE = 60_000;

describeIfDb("sweepCandidates", { concurrency: false }, () => {
  const USER = `test_sweep_${randomUUID().replace(/-/g, "")}`;
  let dbModule: typeof import("@/db/client");
  let store: typeof import("@/jobs/store.db");
  let sweepCandidates: typeof import("./sweep").sweepCandidates;
  let available = false;
  const now = new Date();

  /** Every job written, with what the query should say about it. */
  const made: { id: string; kind: JobKind; requestId: string; status: JobStatus; updatedAt: Date }[] = [];

  async function job(kind: JobKind, options: { requestId?: string; status?: JobStatus; ageMs: number }): Promise<string> {
    const requestId = options.requestId ?? randomUUID();
    const input = { kind } as unknown as StoredJobInput;
    const { job: row } = await store.dbJobStore.create({ userId: USER, avatarId: null, kind, requestId, input, credits: 0 });
    const status = options.status ?? "running";
    const updatedAt = new Date(now.getTime() - options.ageMs);
    await dbModule.db().update(dbModule.schema.jobs).set({ status, updatedAt }).where(eq(dbModule.schema.jobs.id, row.id));
    made.push({ id: row.id, kind, requestId, status, updatedAt });
    return row.id;
  }

  const ids: Record<string, string> = {};

  before(async () => {
    dbModule = await import("@/db/client");
    store = await import("@/jobs/store.db");
    ({ sweepCandidates } = await import("./sweep"));
    try {
      available = await store.jobTablesExist();
    } catch {
      available = false;
    }
    if (!available) return;
    await dbModule.db().insert(dbModule.schema.users).values({ id: USER, email: `${USER}@example.invalid` });

    ids.oldAgent = await job("agent", { ageMs: 9 * MINUTE });
    ids.agent = await job("agent", { ageMs: 2 * MINUTE, status: "queued" });
    ids.clip = await job("clip", { ageMs: 3 * MINUTE });
    ids.stuckImage = await job("image", { ageMs: 11 * MINUTE });
    ids.stuckReel = await job("reel", { ageMs: 12 * MINUTE });

    // None of these may come back.
    ids.freshAgent = await job("agent", { ageMs: SWEEP_IDLE_MS / 2 });
    ids.childPhoto = await job("image", { ageMs: 30 * MINUTE, requestId: `${ids.oldAgent}:photo:0` });
    ids.childClip = await job("clip", { ageMs: 5 * MINUTE, requestId: `${ids.oldAgent}:clip:0` });
    ids.childReel = await job("reel", { ageMs: 30 * MINUTE, requestId: `${ids.oldAgent}:reel:0` });
    ids.doneAgent = await job("agent", { ageMs: 20 * MINUTE, status: "completed" });
    ids.failedClip = await job("clip", { ageMs: 20 * MINUTE, status: "failed" });
    ids.workingImage = await job("image", { ageMs: 5 * MINUTE });
    ids.workingCarousel = await job("carousel", { ageMs: 5 * MINUTE });
  });

  after(async () => {
    if (!available) return;
    await dbModule.db().delete(dbModule.schema.users).where(eq(dbModule.schema.users.id, USER));
  });

  test("takes unfinished top-level jobs left alone long enough, oldest first, and nothing else", async (t) => {
    if (!available) return t.skip("the jobs tables are not migrated");
    const rows = await sweepCandidates(now, { userId: USER });
    assert.deepEqual(
      rows.map((row) => row.jobId),
      [ids.stuckReel, ids.stuckImage, ids.oldAgent, ids.clip, ids.agent],
    );
    for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ["jobId", "kind", "userId"], "who, which and what kind: nothing of the job itself");
    assert.ok(rows.every((row) => row.userId === USER));
  });

  test("agrees with the rules in TypeScript, row for row", async (t) => {
    if (!available) return t.skip("the jobs tables are not migrated");
    const taken = new Set((await sweepCandidates(now, { userId: USER, limit: 100 })).map((row) => row.jobId));
    for (const row of made) {
      const expected = (row.status === "queued" || row.status === "running") && isTopLevel(row.kind, row.requestId) && isDue(row.kind, row.updatedAt, now);
      assert.equal(taken.has(row.id), expected, `${row.kind} ${row.requestId} ${row.status}`);
    }
  });

  test("respects the limit, keeping the oldest", async (t) => {
    if (!available) return t.skip("the jobs tables are not migrated");
    const rows = await sweepCandidates(now, { userId: USER, limit: 2 });
    assert.deepEqual(rows.map((row) => row.jobId), [ids.stuckReel, ids.stuckImage]);
  });

  test("a job touched since is left for the next run", async (t) => {
    if (!available) return t.skip("the jobs tables are not migrated");
    const later = new Date(now.getTime() + SWEEP_IDLE_MS / 2);
    await dbModule.db().update(dbModule.schema.jobs).set({ updatedAt: now }).where(eq(dbModule.schema.jobs.id, ids.agent));
    const rows = await sweepCandidates(later, { userId: USER });
    assert.equal(rows.some((row) => row.jobId === ids.agent), false);
  });
});

import { agentView, isAgentRecord, type AgentView } from "@/agent/view";
import { releaseFreePhoto } from "@/data/freebie";
import { getMedia } from "@/data/media";
import { finishedMedia, isWeekRecord, weekView, type WeekView } from "@/week/view";

import { advanceJob, getJobRecord, type JobDeps } from "./index";
import { freebieClaim, type JobView } from "./types";

/* The polls. Asking about a job is also what moves it along: the caller keeps
   asking, and each ask checks the provider, stores a finished clip, or writes
   off a job that died. The job is looked up scoped to the user asking, so
   another person's id is simply not found. Null means not found; anything
   thrown is ours, not the job's, because `advanceJob` fails jobs rather than
   throwing. */

/** One poll of any job. */
export async function pollJob(userId: string, jobId: string, deps: Partial<JobDeps> = {}): Promise<JobView | null> {
  const job = await advanceJob(userId, jobId, deps);
  if (!job) return null;

  /* A job that cost credits refunds itself inside the job machine, because
     the ledger is the job machine's business. The free photo has no ledger
     row to put back — what it spent is the one claim on the `users` row — so
     returning that is done here, at the one place that learns a job failed.
     A gift that was never delivered should still be a gift. */
  if (job.status === "failed") await returnFreebie(userId, jobId, deps);
  return job;
}

/**
 * Hand back the freebie a failed job spent.
 *
 * Conditional on the exact claim recorded on the job, so it cannot release a
 * claim taken since, and safe on every poll of the same failed job: the second
 * call matches nothing and writes nothing.
 */
async function returnFreebie(userId: string, jobId: string, deps: Partial<JobDeps>): Promise<void> {
  try {
    const record = await getJobRecord(userId, jobId, deps);
    const claim = record ? freebieClaim(record.input) : null;
    if (!claim) return;
    if (await releaseFreePhoto(userId, claim)) {
      console.log(`[api/jobs] free photo returned to ${userId} after job ${jobId} failed`);
    }
  } catch (error) {
    /* Never turn a poll into a failure over this. The worst case is an
       account whose gift stays spent on a job that failed — a support email,
       not a broken page. */
    console.error("[api/jobs] could not return a free photo —", error instanceof Error ? error.message : error);
  }
}

/**
 * One poll of an agent run: one step taken (write, decide, start a child or
 * ask a child how it is going), answered with the run's own state so every
 * step and what it made can be shown. Null for anything that is not her run.
 */
export async function pollAgent(userId: string, id: string, deps: Partial<JobDeps> = {}): Promise<AgentView | null> {
  const job = await advanceJob(userId, id, deps);
  if (!job || job.kind !== "agent") return null;
  const record = await getJobRecord(userId, id, deps);
  if (!record || !isAgentRecord(record)) return null;
  return agentView(record);
}

/** One poll of a week: one stage taken, answered with what she may see of it. Null for anything that is not her week. */
export async function pollWeek(userId: string, id: string, deps: Partial<JobDeps> = {}): Promise<WeekView | null> {
  const job = await advanceJob(userId, id, deps);
  if (!job || job.kind !== "week") return null;
  const record = await getJobRecord(userId, id, deps);
  if (!record || !isWeekRecord(record)) return null;
  const view = weekView(record);
  // Only her own rows are read: getMedia is scoped to the user asking.
  for (const post of view.posts) {
    const rows = await Promise.all(post.mediaIds.map((mediaId) => getMedia(userId, mediaId)));
    post.show = finishedMedia(rows.flatMap((row) => (row ? [{ id: row.id, kind: row.kind }] : [])));
  }
  return view;
}

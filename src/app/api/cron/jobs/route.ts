import { sweepCandidates } from "@/data/sweep";
import { pollAgent, pollJob, pollWeek } from "@/jobs/poll";
import { runSweep, sweepPoll, type SweepRow } from "@/jobs/sweep";
import { cronAuthorised } from "@/lib/cron-auth";
import { logUnexpected } from "@/lib/errors";

/* The every-minute job sweep: moves along the unfinished jobs nobody is
   polling, so a run or a clip she closed the page on finishes, or fails and
   refunds, instead of holding credits until she comes back. Which jobs, and
   why, is `src/jobs/sweep.ts`.

   Authenticated by `Authorization: Bearer <CRON_SECRET>`, which Vercel Cron
   sends by itself, and 401 without it (`cronAuthorised`, tested). Public by
   exact match in `src/proxy.ts`, because a scheduler has no session.

   Every row is polled as its own user with the poll that user's own screen
   calls, so nothing here reaches across accounts after the one query does.
   Nothing is bought here that was not already bought: a run's children are
   part of the price that was checked when it started.

   The work a poll schedules (the next photo, a clip's download) runs with
   `after()`, after this response, inside this route's `maxDuration`: which is
   why the loop stops starting rows well before the limit. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function poll(row: SweepRow): Promise<boolean> {
  switch (sweepPoll(row.kind)) {
    case "agent":
      return (await pollAgent(row.userId, row.jobId)) !== null;
    case "week":
      return (await pollWeek(row.userId, row.jobId)) !== null;
    case "job":
      return (await pollJob(row.userId, row.jobId)) !== null;
    case null:
      return false;
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!cronAuthorised(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }

  try {
    const rows = await sweepCandidates(new Date());
    const summary = await runSweep(rows, {
      poll,
      // The job id goes to our log, never into the response.
      failed: (row, error) => void logUnexpected(`jobs cron: ${row.kind} ${row.jobId}`, error),
      clock: () => Date.now(),
    });
    if (summary.found > 0) console.log("jobs cron:", JSON.stringify(summary));
    return Response.json({ ok: true, ...summary });
  } catch (error) {
    const reference = logUnexpected("jobs cron", error);
    return Response.json({ ok: false, ref: reference }, { status: 500 });
  }
}

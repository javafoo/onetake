import { auth } from "@clerk/nextjs/server";

import { pollJob } from "@/jobs/poll";
import { logUnexpected } from "@/lib/errors";

/* The poll. Asking about a job is also what moves it along: the client keeps
   calling this, and each call checks the provider, stores a finished clip, or
   writes off a job that died. When nobody is asking, the every-minute sweep
   (`/api/cron/jobs`) asks instead, through the same `pollJob`; there is no
   worker.

   The job is looked up scoped to the signed-in user, so another person's id is
   a 404 rather than a window onto their work. The poll itself, and the free
   photo handed back when a job fails, are in `src/jobs/poll.ts`. */

/* Long enough for the slowest thing a single poll does: ask the video
   service, pull down a finished clip (a few megabytes) and store it. Not long
   enough to be the place a whole generation is waited out — that is the
   point of polling. */
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return json({ error: "Not signed in" }, 401);

  const { id } = await context.params;
  try {
    const job = await pollJob(userId, id);
    if (!job) return json({ error: "Not found" }, 404);
    return json(job, 200);
  } catch (error) {
    // advanceJob fails jobs rather than throwing; anything reaching here is ours.
    logUnexpected("api/jobs advance", error);
    return json({ error: "Something went wrong checking this job. Try again in a moment." }, 500);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

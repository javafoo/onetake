import { auth } from "@clerk/nextjs/server";

import { pollAgent } from "@/jobs/poll";
import { logUnexpected } from "@/lib/errors";

/* The chat's poll. Like /api/jobs/[id], asking is what moves the run along:
   each call takes one step (writes, decides, starts a child or asks a child
   how it is going) and answers with the run's own state rather than the bare
   job view, so the chat can show every step and what it made. */

/* The children of a run (a photo, a reel, a set) do their work after this
   route's response, inside its time limit: a photo takes about a minute and
   a set about as long, so the limit is the pages' 300, not the clip poll's 60. */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return json({ error: "Not signed in" }, 401);

  const { id } = await context.params;
  try {
    const run = await pollAgent(userId, id);
    if (!run) return json({ error: "Not found" }, 404);
    return json(run, 200);
  } catch (error) {
    logUnexpected("api/agent advance", error);
    return json({ error: "Something went wrong checking this run. Try again in a moment." }, 500);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

import { auth } from "@clerk/nextjs/server";

import { pollWeek } from "@/jobs/poll";
import { logUnexpected } from "@/lib/errors";

/* The week's poll. Asking is what moves it along: each call takes one stage
   (listen, understand, research, plan, write, review, or start and check the
   posts) and answers with what she may see. Planning is one long reasoning
   call, so the limit is the platform's 300 seconds. */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return json({ error: "Not signed in" }, 401);

  const { id } = await context.params;
  try {
    const week = await pollWeek(userId, id);
    if (!week) return json({ error: "Not found" }, 404);
    return json(week, 200);
  } catch (error) {
    logUnexpected("api/week advance", error);
    return json({ error: "Something went wrong checking your week. Try again in a moment." }, 500);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

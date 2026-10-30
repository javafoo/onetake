import { sql } from "drizzle-orm";

import { db } from "@/db/client";

export const dynamic = "force-dynamic";

/* The liveness check an uptime monitor pings: the function answers and the
   database answers. It is public on purpose and says nothing beyond that — no
   version, no region, no error text — so it gives a stranger nothing and a
   monitor exactly one bit. The render check (`/api/health/render`) stays
   behind its token because it is expensive and describes the server. */
export async function GET(): Promise<Response> {
  try {
    await db().execute(sql`select 1`);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

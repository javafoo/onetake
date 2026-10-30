import { and, desc, eq, gt } from "drizzle-orm";

import { db, schema } from "@/db/client";

import { isUuid } from "./ids";

/* Her weeks: the newest one, so the Your week page can show a week that is
   still being made (or was just finished) when she comes back to it. */

/** How long a finished week stays on the page before it offers a new one. */
export const SHOW_WEEK_FOR_MS = 3 * 24 * 60 * 60 * 1000;

export async function latestWeekId(userId: string, avatarId: string, now: Date = new Date()): Promise<string | null> {
  if (!isUuid(avatarId)) return null;
  const [row] = await db()
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.userId, userId), eq(schema.jobs.avatarId, avatarId), eq(schema.jobs.kind, "week"), gt(schema.jobs.createdAt, new Date(now.getTime() - SHOW_WEEK_FOR_MS))))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(1);
  return row?.id ?? null;
}

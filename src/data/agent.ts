import { and, desc, eq } from "drizzle-orm";

import { agentView, isAgentRecord, type AgentView } from "@/agent/view";
import { db, schema } from "@/db/client";
import { toRecord } from "@/jobs/store.db";

/* The chat's history is the account's agent runs, newest first. Read through
   the job store's own row mapper, scoped to the owner like everything here. */

export async function listAgentRuns(userId: string, limit = 30, avatarId?: string): Promise<AgentView[]> {
  const rows = await db()
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.userId, userId), eq(schema.jobs.kind, "agent"), avatarId ? eq(schema.jobs.avatarId, avatarId) : undefined))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(limit);
  return rows.map(toRecord).filter(isAgentRecord).map(agentView);
}

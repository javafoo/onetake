import { and, desc, eq, isNull, lt, ne, or, sql } from "drizzle-orm";

import type { Offer, ThreadMessage } from "@/agent/v2/types";
import type { ThreadState } from "@/agent/v2/thread";
import { db, schema } from "@/db/client";

import { getAvatar } from "./avatars";
import { isUuid } from "./ids";

/* Agent v2 chats: one row per thread, the messages and offers as json.
 *
 * Every function takes the user id first and filters on it, so a thread id
 * from the browser reaches nothing that is not hers. Writes are optimistic:
 * a change is applied to the row as it was read and saved only if nobody
 * wrote in between (`updated_at` unchanged), else read again and retried. A
 * tap on an offer while a turn is still streaming lands on the same row, and
 * neither write loses the other's messages. */

type Row = typeof schema.agentThreads.$inferSelect;

export type ThreadSummary = { id: string; title: string; updatedAt: Date };
export type StoredThread = ThreadState & { userId: string; updatedAt: Date; createdAt: Date };

const toThread = (row: Row): StoredThread => ({
  id: row.id,
  userId: row.userId,
  avatarId: row.avatarId,
  title: row.title,
  messages: (row.messages ?? []) as ThreadMessage[],
  budgetCredits: row.budgetCredits,
  spentCredits: row.spentCredits,
  offers: (row.offers ?? []) as Offer[],
  lastRequestId: row.lastRequestId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** A new, empty thread on one of her avatars. Throws when the avatar is not hers. */
export async function createThread(userId: string, avatarId: string): Promise<StoredThread> {
  if (!isUuid(avatarId) || !(await getAvatar(userId, avatarId))) throw new Error("Avatar not found");
  const [row] = await db().insert(schema.agentThreads).values({ userId, avatarId }).returning();
  return toThread(row);
}

export async function getThread(userId: string, threadId: string): Promise<StoredThread | null> {
  if (!isUuid(threadId)) return null;
  const [row] = await db()
    .select()
    .from(schema.agentThreads)
    .where(and(eq(schema.agentThreads.id, threadId), eq(schema.agentThreads.userId, userId)))
    .limit(1);
  return row ? toThread(row) : null;
}

/** The newest threads on one avatar that have something in them, for the drawer. */
export async function listThreads(userId: string, avatarId: string, limit = 10): Promise<ThreadSummary[]> {
  if (!isUuid(avatarId)) return [];
  const rows = await db()
    .select({ id: schema.agentThreads.id, title: schema.agentThreads.title, updatedAt: schema.agentThreads.updatedAt })
    .from(schema.agentThreads)
    .where(and(eq(schema.agentThreads.userId, userId), eq(schema.agentThreads.avatarId, avatarId), sql`${schema.agentThreads.title} is not null`))
    .orderBy(desc(schema.agentThreads.updatedAt))
    .limit(limit);
  return rows.map((row) => ({ id: row.id, title: row.title ?? "New chat", updatedAt: row.updatedAt }));
}

/**
 * Take this request id for the thread's next turn. False when the thread's
 * last turn already had it: a resent message is answered once.
 */
export async function claimTurn(userId: string, threadId: string, requestId: string): Promise<boolean> {
  if (!isUuid(threadId)) return false;
  const claimed = await db()
    .update(schema.agentThreads)
    .set({ lastRequestId: requestId, updatedAt: new Date() })
    .where(
      and(
        eq(schema.agentThreads.id, threadId),
        eq(schema.agentThreads.userId, userId),
        or(isNull(schema.agentThreads.lastRequestId), ne(schema.agentThreads.lastRequestId, requestId)),
      ),
    )
    .returning({ id: schema.agentThreads.id });
  return claimed.length > 0;
}

const ATTEMPTS = 5;

/* A row written by the database's own now() keeps microseconds; a JS date has
   milliseconds. Compared at the coarser of the two, or the first write to a
   new thread would never match. */
const sameInstant = (column: typeof schema.agentThreads.updatedAt, when: Date) =>
  sql`date_trunc('milliseconds', ${column}) = ${when.toISOString()}::timestamptz`;

/**
 * Change a thread: `change` gets the newest row and returns the new state (or
 * null to leave it), and the write only lands if the row did not move since.
 * Returns the saved thread, or null when there is no such thread for her.
 */
export async function mutateThread(userId: string, threadId: string, change: (thread: StoredThread) => ThreadState | null): Promise<StoredThread | null> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const current = await getThread(userId, threadId);
    if (!current) return null;
    const next = change(current);
    if (!next) return current;
    const [row] = await db()
      .update(schema.agentThreads)
      .set({
        title: next.title,
        messages: next.messages,
        offers: next.offers,
        budgetCredits: next.budgetCredits,
        spentCredits: next.spentCredits,
        updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)),
      })
      .where(and(eq(schema.agentThreads.id, threadId), eq(schema.agentThreads.userId, userId), sameInstant(schema.agentThreads.updatedAt, current.updatedAt)))
      .returning();
    if (row) return toThread(row);
  }
  throw new Error("The chat changed while it was being saved. Try again.");
}

/* ---- Retention ------------------------------------------------------------ */

/** Threads nobody has touched since `cutoff`. A cross-tenant count, like retention's, narrowed to one account when asked. */
export async function countThreadsBefore(cutoff: Date, userId?: string): Promise<number> {
  const [row] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.agentThreads)
    .where(and(lt(schema.agentThreads.updatedAt, cutoff), userId ? eq(schema.agentThreads.userId, userId) : undefined));
  return row?.count ?? 0;
}

/** Delete them. A fact remembered in one keeps its text; its thread link goes to null. */
export async function deleteThreadsBefore(cutoff: Date, userId?: string): Promise<number> {
  const rows = await db()
    .delete(schema.agentThreads)
    .where(and(lt(schema.agentThreads.updatedAt, cutoff), userId ? eq(schema.agentThreads.userId, userId) : undefined))
    .returning({ id: schema.agentThreads.id });
  return rows.length;
}

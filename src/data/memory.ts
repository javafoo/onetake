import { and, desc, eq } from "drizzle-orm";

import { db, schema } from "@/db/client";

import { getAvatar } from "./avatars";
import { isUuid } from "./ids";

/* Brand memory: short facts about her that the agent learned or she typed on
   the Brand page. They are allowed ground for every writer, like her story
   and proof points, so only she can see and change them, and every query is
   scoped to her account. */

export type Fact = { id: string; text: string; source: "agent" | "her"; createdAt: Date };

/** A fact is one line. Longer than this is a paragraph, not a fact. */
export const MAX_FACT_CHARS = 300;
/** What a writer is shown: enough to matter, few enough to keep a prompt short. */
export const MAX_MEMORY_LINES = 40;

/** One line, trimmed and cut to size. Empty means nothing to save. */
export function cleanFact(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_FACT_CHARS).trim();
}

/** Pure. The lines a writer gets: newest first, no repeats, at most 40. */
export function memoryLines(facts: Fact[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const fact of [...facts].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    const line = cleanFact(fact.text);
    const key = line.toLowerCase();
    if (!line || seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
    if (lines.length === MAX_MEMORY_LINES) break;
  }
  return lines;
}

const toFact = (row: typeof schema.brandMemory.$inferSelect): Fact => ({ id: row.id, text: row.text, source: row.source, createdAt: row.createdAt });

export async function listFacts(userId: string, avatarId: string): Promise<Fact[]> {
  if (!isUuid(avatarId)) return [];
  const rows = await db()
    .select()
    .from(schema.brandMemory)
    .where(and(eq(schema.brandMemory.userId, userId), eq(schema.brandMemory.avatarId, avatarId)))
    .orderBy(desc(schema.brandMemory.createdAt));
  return rows.map(toFact);
}

/** The avatar is looked up as hers first: an id from a form or a model is not trusted. */
export async function addFact(userId: string, avatarId: string, text: string, source: Fact["source"], threadId?: string): Promise<Fact> {
  const line = cleanFact(text);
  if (!line) throw new Error("A fact needs some words.");
  if (!(await getAvatar(userId, avatarId))) throw new Error("Avatar not found");
  const [row] = await db()
    .insert(schema.brandMemory)
    .values({ userId, avatarId, text: line, source, threadId: threadId && isUuid(threadId) ? threadId : null })
    .returning();
  return toFact(row);
}

/** Changes nothing when the fact is not hers. Her edit makes the fact hers. */
export async function editFact(userId: string, factId: string, text: string): Promise<void> {
  const line = cleanFact(text);
  if (!line) throw new Error("A fact needs some words.");
  if (!isUuid(factId)) return;
  await db()
    .update(schema.brandMemory)
    .set({ text: line, source: "her", updatedAt: new Date() })
    .where(and(eq(schema.brandMemory.id, factId), eq(schema.brandMemory.userId, userId)));
}

export async function deleteFact(userId: string, factId: string): Promise<void> {
  if (!isUuid(factId)) return;
  await db().delete(schema.brandMemory).where(and(eq(schema.brandMemory.id, factId), eq(schema.brandMemory.userId, userId)));
}

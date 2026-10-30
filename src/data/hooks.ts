import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";

import { db, schema } from "@/db/client";
import { InvalidRequestError } from "@/lib/errors";

import { getAvatar } from "./avatars";
import { cleanHookText, dedupeHookTexts, hookFilterSpec, likePattern, normaliseHookText, type HookFilter } from "./hook-rules";
import { isUuid } from "./ids";

/* Saved hooks: the words alone, for the Hooks page.
 *
 * Every function takes the user id first and filters on it. The avatar a hook
 * is filed under is checked against the same user before anything is written,
 * so an avatar id from a cookie or a form cannot file a hook on someone else's
 * avatar. Duplicates are refused by the database (`hooks_avatar_text_idx`, on
 * the avatar and the trimmed, lower-cased text); this file turns that refusal
 * into a sentence. */

export type Hook = typeof schema.hooks.$inferSelect;
export type HookUse = "reel" | "carousel" | "copied";

export const DUPLICATE_HOOK = "That hook is already saved.";

/** A page of hooks is more than a week of posting; the search finds the rest. */
const LIST_LIMIT = 300;

const usedSql = (t: typeof schema.hooks) => or(isNotNull(t.usedReelAt), isNotNull(t.usedCarouselAt), isNotNull(t.copiedAt));

async function requireOwnAvatar(userId: string, avatarId: string): Promise<void> {
  if (!isUuid(avatarId) || !(await getAvatar(userId, avatarId))) throw new InvalidRequestError("Finish her setup first.");
}

const cleanIds = (ids: readonly string[]): string[] => [...new Set(ids.filter(isUuid))];

/** `activeOnly`: leave archived hooks out whatever the filter, as the + picker does. */
export type ListHooksOptions = { filter?: HookFilter; query?: string; limit?: number; activeOnly?: boolean };

/** One avatar's hooks, newest first. */
export async function listHooks(userId: string, avatarId: string, options: ListHooksOptions = {}): Promise<Hook[]> {
  if (!isUuid(avatarId)) return [];
  const t = schema.hooks;
  const spec = hookFilterSpec(options.filter ?? "all");
  const where: (SQL | undefined)[] = [eq(t.userId, userId), eq(t.avatarId, avatarId)];
  if (spec.archived !== null) where.push(spec.archived ? isNotNull(t.archivedAt) : isNull(t.archivedAt));
  if (options.activeOnly) where.push(isNull(t.archivedAt));
  if (spec.used !== null) where.push(spec.used ? usedSql(t) : sql`not (${usedSql(t)})`);
  if (options.query) where.push(sql`${t.text} ilike ${likePattern(options.query)}`);
  return db()
    .select()
    .from(t)
    .where(and(...where))
    .orderBy(desc(t.createdAt), desc(t.id))
    .limit(options.limit ?? LIST_LIMIT);
}

/** How many hooks each filter holds, before any search. One query. */
export async function countHooks(userId: string, avatarId: string): Promise<Record<HookFilter, number>> {
  const zero = { unused: 0, used: 0, archived: 0, all: 0 };
  if (!isUuid(avatarId)) return zero;
  const t = schema.hooks;
  const [row] = await db()
    .select({
      all: sql<number>`count(*)::int`,
      archived: sql<number>`count(*) filter (where ${t.archivedAt} is not null)::int`,
      used: sql<number>`count(*) filter (where ${t.archivedAt} is null and ${usedSql(t)})::int`,
      unused: sql<number>`count(*) filter (where ${t.archivedAt} is null and not (${usedSql(t)}))::int`,
    })
    .from(t)
    .where(and(eq(t.userId, userId), eq(t.avatarId, avatarId)));
  return row ?? zero;
}

export async function getHook(userId: string, hookId: string): Promise<Hook | null> {
  if (!isUuid(hookId)) return null;
  const [row] = await db()
    .select()
    .from(schema.hooks)
    .where(and(eq(schema.hooks.id, hookId), eq(schema.hooks.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * Several hooks at once, each once. Words already saved for this avatar are
 * skipped quietly: a batch from the writer that repeats an old line is not an
 * error. Returns what was actually added.
 */
export async function addHooks(userId: string, avatarId: string, texts: readonly string[]): Promise<Hook[]> {
  const unique = dedupeHookTexts(texts);
  if (unique.length === 0) return [];
  await requireOwnAvatar(userId, avatarId);
  return db()
    .insert(schema.hooks)
    .values(unique.map((text) => ({ userId, avatarId, text })))
    .onConflictDoNothing()
    .returning();
}

/** One hook, typed or saved from a finished reel. The same words twice are refused with a sentence. */
export async function addHook(userId: string, avatarId: string, text: string): Promise<Hook> {
  const clean = cleanHookText(text);
  if (!clean) throw new InvalidRequestError("Type the hook first.");
  const [row] = await addHooks(userId, avatarId, [clean]);
  if (!row) throw new InvalidRequestError(DUPLICATE_HOOK);
  return row;
}

/** New words for a hook. Null when the hook is not this user's. */
export async function updateHookText(userId: string, hookId: string, text: string): Promise<Hook | null> {
  const existing = await getHook(userId, hookId);
  if (!existing) return null;
  const clean = cleanHookText(text);
  if (!clean) throw new InvalidRequestError("Type the hook first.");
  const t = schema.hooks;
  /* Asked first so the answer is a sentence; the unique index still has the
     last word if two saves race. */
  const [clash] = await db()
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.userId, userId), eq(t.avatarId, existing.avatarId), ne(t.id, existing.id), sql`lower(trim(${t.text})) = ${normaliseHookText(clean)}`))
    .limit(1);
  if (clash) throw new InvalidRequestError(DUPLICATE_HOOK);
  const [row] = await db()
    .update(t)
    .set({ text: clean, updatedAt: new Date() })
    .where(and(eq(t.id, existing.id), eq(t.userId, userId)))
    .returning();
  return row ?? null;
}

/** Archive or bring back. Returns how many of this user's hooks changed; others' ids are ignored. */
export async function setHooksArchived(userId: string, hookIds: readonly string[], archived: boolean): Promise<number> {
  const ids = cleanIds(hookIds);
  if (ids.length === 0) return 0;
  const t = schema.hooks;
  const rows = await db()
    .update(t)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(t.userId, userId), inArray(t.id, ids)))
    .returning({ id: t.id });
  return rows.length;
}

export async function deleteHooks(userId: string, hookIds: readonly string[]): Promise<number> {
  const ids = cleanIds(hookIds);
  if (ids.length === 0) return 0;
  const t = schema.hooks;
  const rows = await db()
    .delete(t)
    .where(and(eq(t.userId, userId), inArray(t.id, ids)))
    .returning({ id: t.id });
  return rows.length;
}

/**
 * Stamp what a hook became. The first time is kept: a hook made into two
 * reels still says when it was first used. Null when it is not this user's.
 */
export async function markHookUsed(userId: string, hookId: string, use: HookUse): Promise<Hook | null> {
  if (!isUuid(hookId)) return null;
  const t = schema.hooks;
  const stamp =
    use === "reel"
      ? { usedReelAt: sql`coalesce(${t.usedReelAt}, now())` }
      : use === "carousel"
        ? { usedCarouselAt: sql`coalesce(${t.usedCarouselAt}, now())` }
        : { copiedAt: sql`coalesce(${t.copiedAt}, now())` };
  const [row] = await db()
    .update(t)
    .set({ ...stamp, updatedAt: new Date() })
    .where(and(eq(t.id, hookId), eq(t.userId, userId)))
    .returning();
  return row ?? null;
}

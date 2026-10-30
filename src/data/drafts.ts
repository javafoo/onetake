import { and, desc, eq, inArray } from "drizzle-orm";

import { checkDraftEdit, type DraftEdit } from "@/content/draft-edit";
import type { PostIdea } from "@/content/hooks";
import { keywordsOf } from "@/content/offers";
import { db, schema } from "@/db/client";

import { getAvatar } from "./avatars";
import { getProfile } from "./brand";
import { isUuid } from "./ids";

/* A draft is one planned post: the hook that goes on screen, the caption that
   pays it off, and, once assembled, the reel media it produced. */

export type Draft = typeof schema.drafts.$inferSelect;
export type DraftStatus = Draft["status"];

export type ListDraftsOptions = { limit?: number; avatarId?: string };

export async function listDrafts(userId: string, options: ListDraftsOptions = {}): Promise<Draft[]> {
  return db()
    .select()
    .from(schema.drafts)
    .where(and(eq(schema.drafts.userId, userId), options.avatarId ? eq(schema.drafts.avatarId, options.avatarId) : undefined))
    .orderBy(desc(schema.drafts.createdAt))
    .limit(options.limit ?? 200);
}

export async function getDraft(userId: string, draftId: string): Promise<Draft | null> {
  if (!isUuid(draftId)) return null;
  const [row] = await db()
    .select()
    .from(schema.drafts)
    .where(and(eq(schema.drafts.id, draftId), eq(schema.drafts.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Several of her drafts by id, in one query: the Favorites tab's reels need their hooks. Foreign ids return nothing. */
export async function getDraftsByIds(userId: string, draftIds: string[]): Promise<Draft[]> {
  const ids = [...new Set(draftIds.filter(isUuid))];
  if (ids.length === 0) return [];
  return db()
    .select()
    .from(schema.drafts)
    .where(and(eq(schema.drafts.userId, userId), inArray(schema.drafts.id, ids)));
}

export async function addDrafts(userId: string, avatarId: string, posts: PostIdea[]): Promise<Draft[]> {
  if (posts.length === 0) return [];
  if (!(await getAvatar(userId, avatarId))) throw new Error("Avatar not found");
  return db()
    .insert(schema.drafts)
    .values(posts.map((post) => ({ userId, avatarId, hook: post.hook, angle: post.angle, caption: post.caption, cta: post.cta })))
    .returning();
}

/**
 * A hook used again: a new draft with the same words, and no clip yet, so the
 * next reel is picked from scratch. Null when the draft is not this user's.
 * The copy is always a reel, whatever the original was; a carousel's cover
 * line makes a fine hook, and a reel is what the Create page assembles.
 */
export async function duplicateDraft(userId: string, draftId: string): Promise<Draft | null> {
  const source = await getDraft(userId, draftId);
  if (!source) return null;
  const [row] = await db()
    .insert(schema.drafts)
    .values({ userId, avatarId: source.avatarId, format: "reel", hook: source.hook, angle: source.angle, caption: source.caption, cta: source.cta })
    .returning();
  return row ?? null;
}

export type DraftPatch = Partial<
  Pick<Draft, "hook" | "angle" | "caption" | "cta" | "status" | "clipMediaId" | "outputMediaId" | "reelSeconds" | "spec" | "format">
>;

export async function updateDraft(userId: string, draftId: string, patch: DraftPatch): Promise<Draft | null> {
  if (!isUuid(draftId)) return null;
  const [row] = await db()
    .update(schema.drafts)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(schema.drafts.id, draftId), eq(schema.drafts.userId, userId)))
    .returning();
  return row ?? null;
}

/**
 * Save a hand-edited hook, caption and call to action.
 *
 * Null means there is no such draft for this user — the same answer a stranger
 * and a typo get, because the row is read scoped to `userId` and never found
 * any other way. Throws `InvalidRequestError` when the edit breaks one of the
 * writer's rules; the keyword it is checked against is this draft's own avatar's,
 * looked up here rather than taken from the caller.
 *
 * `staleReel` is true when this draft already had a reel: that reel still has
 * the old hook printed on it, so the draft goes back to `draft` until it is
 * assembled again. The clip she picked stays picked
 * and the old reel stays downloadable; only its claim to be finished is gone.
 */
export async function applyDraftEdit(
  userId: string,
  draftId: string,
  edit: DraftEdit,
): Promise<{ draft: Draft; staleReel: boolean } | null> {
  const existing = await getDraft(userId, draftId);
  if (!existing) return null;

  const checked = checkDraftEdit(edit, keywordsOf(await getProfile(userId, existing.avatarId)));

  const staleReel = Boolean(existing.outputMediaId);
  const draft = await updateDraft(userId, draftId, {
    ...checked,
    ...(staleReel ? { status: "draft" as const } : {}),
  });
  return draft ? { draft, staleReel } : null;
}

export async function deleteDraft(userId: string, draftId: string): Promise<boolean> {
  if (!isUuid(draftId)) return false;
  const rows = await db()
    .delete(schema.drafts)
    .where(and(eq(schema.drafts.id, draftId), eq(schema.drafts.userId, userId)))
    .returning({ id: schema.drafts.id });
  return rows.length > 0;
}

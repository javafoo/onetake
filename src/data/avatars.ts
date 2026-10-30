import { and, asc, eq, inArray } from "drizzle-orm";

import type { IdentityLock, Descriptor } from "@/identity/build";
import { db, schema } from "@/db/client";

import { isUuid } from "./ids";

/* Avatars and their reference set. avatar_references carries no user_id of its
   own, so every read and write here joins back to avatars and filters on the
   owner: a reference id from a form is never trusted on its own. */

export type Avatar = typeof schema.avatars.$inferSelect;
export type AvatarReference = typeof schema.avatarReferences.$inferSelect;
export type Media = typeof schema.media.$inferSelect;
export type ReferenceRole = AvatarReference["role"];

export type ReferenceWithMedia = AvatarReference & { media: Media };

export async function listAvatars(userId: string): Promise<Avatar[]> {
  return db().select().from(schema.avatars).where(eq(schema.avatars.userId, userId)).orderBy(asc(schema.avatars.createdAt));
}

export async function getAvatar(userId: string, avatarId: string): Promise<Avatar | null> {
  if (!isUuid(avatarId)) return null;
  const [row] = await db()
    .select()
    .from(schema.avatars)
    .where(and(eq(schema.avatars.id, avatarId), eq(schema.avatars.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** The one avatar the UI works with until multi-avatar plans land. */
export async function primaryAvatar(userId: string): Promise<Avatar | null> {
  const [row] = await listAvatars(userId);
  return row ?? null;
}

/** The avatar asked for when it is this user's, else her first: what a caller without the avatar cookie works on. */
export async function avatarOrPrimary(userId: string, avatarId: string | null): Promise<Avatar | null> {
  return (avatarId ? await getAvatar(userId, avatarId) : null) ?? (await primaryAvatar(userId));
}

export async function createAvatar(
  userId: string,
  input: { name: string; kind?: Avatar["kind"]; lock?: IdentityLock; descriptor?: Descriptor },
): Promise<Avatar> {
  const [row] = await db()
    .insert(schema.avatars)
    .values({
      userId,
      name: input.name,
      kind: input.kind ?? "avatar",
      lock: input.lock ?? null,
      descriptor: input.descriptor ?? null,
    })
    .returning();
  return row;
}

/** Creates the avatar on first use so the Brand page works before avatar setup. */
export async function ensurePrimaryAvatar(userId: string, name: string): Promise<Avatar> {
  return (await primaryAvatar(userId)) ?? createAvatar(userId, { name: name.trim() || "My avatar" });
}

export async function updateAvatar(
  userId: string,
  avatarId: string,
  patch: Partial<Pick<Avatar, "name" | "kind" | "likenessConsentAt">> & { lock?: IdentityLock; descriptor?: Descriptor },
): Promise<Avatar | null> {
  if (!isUuid(avatarId)) return null;
  const [row] = await db()
    .update(schema.avatars)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(schema.avatars.id, avatarId), eq(schema.avatars.userId, userId)))
    .returning();
  return row ?? null;
}

export async function deleteAvatar(userId: string, avatarId: string): Promise<boolean> {
  if (!isUuid(avatarId)) return false;
  const rows = await db()
    .delete(schema.avatars)
    .where(and(eq(schema.avatars.id, avatarId), eq(schema.avatars.userId, userId)))
    .returning({ id: schema.avatars.id });
  return rows.length > 0;
}

export function identityLock(avatar: Avatar | null): IdentityLock | null {
  return (avatar?.lock as IdentityLock | null) ?? null;
}

export async function listReferences(userId: string, avatarId: string): Promise<ReferenceWithMedia[]> {
  if (!isUuid(avatarId)) return [];
  const rows = await db()
    .select({ reference: schema.avatarReferences, media: schema.media })
    .from(schema.avatarReferences)
    .innerJoin(schema.avatars, eq(schema.avatars.id, schema.avatarReferences.avatarId))
    .innerJoin(schema.media, eq(schema.media.id, schema.avatarReferences.mediaId))
    .where(and(eq(schema.avatarReferences.avatarId, avatarId), eq(schema.avatars.userId, userId)))
    .orderBy(asc(schema.avatarReferences.position), asc(schema.avatarReferences.createdAt));
  return rows.map((row) => ({ ...row.reference, media: row.media }));
}

export async function addReference(
  userId: string,
  avatarId: string,
  input: { mediaId: string; role: ReferenceRole; source: AvatarReference["source"]; approved?: boolean; position?: number },
): Promise<AvatarReference> {
  if (!(await getAvatar(userId, avatarId))) throw new Error("Avatar not found");
  // The media must be the caller's too, or a reference would point at another tenant's bytes.
  const [owned] = await db()
    .select({ id: schema.media.id })
    .from(schema.media)
    .where(and(eq(schema.media.id, input.mediaId), eq(schema.media.userId, userId)))
    .limit(1);
  if (!owned) throw new Error("Media not found");

  const [row] = await db()
    .insert(schema.avatarReferences)
    .values({
      avatarId,
      mediaId: input.mediaId,
      role: input.role,
      source: input.source,
      approved: input.approved ?? false,
      position: input.position ?? 0,
    })
    .returning();
  return row;
}

async function ownedReference(userId: string, referenceId: string): Promise<AvatarReference | null> {
  if (!isUuid(referenceId)) return null;
  const [row] = await db()
    .select({ reference: schema.avatarReferences })
    .from(schema.avatarReferences)
    .innerJoin(schema.avatars, eq(schema.avatars.id, schema.avatarReferences.avatarId))
    .where(and(eq(schema.avatarReferences.id, referenceId), eq(schema.avatars.userId, userId)))
    .limit(1);
  return row?.reference ?? null;
}

export async function approveReference(userId: string, referenceId: string): Promise<AvatarReference | null> {
  const existing = await ownedReference(userId, referenceId);
  if (!existing) return null;
  const [row] = await db()
    .update(schema.avatarReferences)
    .set({ approved: true })
    .where(eq(schema.avatarReferences.id, referenceId))
    .returning();
  return row ?? null;
}

export async function deleteReference(userId: string, referenceId: string): Promise<boolean> {
  if (!(await ownedReference(userId, referenceId))) return false;
  await db().delete(schema.avatarReferences).where(eq(schema.avatarReferences.id, referenceId));
  return true;
}

/** Originals first, then approved generated views, capped at the model's limit.
    The first reference sets the look, so the order is part of the contract. */
export async function referenceMediaIds(userId: string, avatarId: string, limit = 5): Promise<string[]> {
  const references = await listReferences(userId, avatarId);
  const originals = references.filter((item) => item.source === "original");
  const covered = new Set(originals.map((item) => item.role));
  const generated = references.filter((item) => item.source === "generated" && item.approved && !covered.has(item.role));
  return [...originals, ...generated].slice(0, limit).map((item) => item.mediaId);
}

export async function referenceCount(userId: string, avatarId: string): Promise<number> {
  const references = await listReferences(userId, avatarId);
  return references.filter((item) => item.source === "original" || item.approved).length;
}

/** Used by the import script to avoid adding the same photo twice. */
export async function referenceMediaSet(userId: string, avatarId: string): Promise<Set<string>> {
  const references = await listReferences(userId, avatarId);
  return new Set(references.map((item) => item.mediaId));
}

export async function referencesForMedia(userId: string, mediaIds: string[]): Promise<ReferenceWithMedia[]> {
  if (mediaIds.length === 0) return [];
  const rows = await db()
    .select({ reference: schema.avatarReferences, media: schema.media })
    .from(schema.avatarReferences)
    .innerJoin(schema.avatars, eq(schema.avatars.id, schema.avatarReferences.avatarId))
    .innerJoin(schema.media, eq(schema.media.id, schema.avatarReferences.mediaId))
    .where(and(inArray(schema.avatarReferences.mediaId, mediaIds), eq(schema.avatars.userId, userId)));
  return rows.map((row) => ({ ...row.reference, media: row.media }));
}

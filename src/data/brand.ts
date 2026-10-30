import { and, eq } from "drizzle-orm";

import type { Brief } from "@/brief/build";
import type { TopicSuggestion } from "@/carousel/topics";
import type { BrandProfile } from "@/content/hooks";
import { db, schema } from "@/db/client";

import { getAvatar } from "./avatars";
import { isUuid } from "./ids";

/* One brand profile per avatar: what the writer is allowed to say, plus the
   one-page brief distilled from the creator's own documents. */

export type BrandProfileRow = typeof schema.brandProfiles.$inferSelect;

export const EMPTY_PROFILE: BrandProfile = {
  niche: "",
  audience: "",
  offer: "",
  keyword: "",
  voice: "",
  proofPoints: [],
  winners: [],
};

export function profileComplete(profile: BrandProfile): boolean {
  return Boolean(profile.niche && profile.audience && profile.offer && profile.keyword);
}

export async function getBrand(userId: string, avatarId: string): Promise<BrandProfileRow | null> {
  if (!isUuid(avatarId)) return null;
  const [row] = await db()
    .select()
    .from(schema.brandProfiles)
    .where(and(eq(schema.brandProfiles.avatarId, avatarId), eq(schema.brandProfiles.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function getProfile(userId: string, avatarId: string | null): Promise<BrandProfile> {
  if (!avatarId) return EMPTY_PROFILE;
  const row = await getBrand(userId, avatarId);
  return (row?.profile as BrandProfile | undefined) ?? EMPTY_PROFILE;
}

export async function getBrief(userId: string, avatarId: string | null): Promise<Brief | null> {
  if (!avatarId) return null;
  const row = await getBrand(userId, avatarId);
  return (row?.brief as Brief | null) ?? null;
}

/* Topic suggestions are written once per distinct brand and read back from the
   row, so a page reload is a read rather than a model call and the answer
   survives a deploy. `topicsKey` is a hash of the fields the prompt reads, so
   re-saving the same words is not a new question. */
export async function getTopics(
  userId: string,
  avatarId: string | null,
  key: string,
): Promise<TopicSuggestion[] | null> {
  if (!avatarId) return null;
  const row = await getBrand(userId, avatarId);
  if (!row || row.topicsKey !== key) return null;
  return (row.topics as TopicSuggestion[] | null) ?? null;
}

export async function saveTopics(
  userId: string,
  avatarId: string,
  key: string,
  topics: TopicSuggestion[],
): Promise<void> {
  await db()
    .update(schema.brandProfiles)
    .set({ topics, topicsKey: key })
    .where(and(eq(schema.brandProfiles.avatarId, avatarId), eq(schema.brandProfiles.userId, userId)));
}

/* avatar_id is the primary key here, so an id from a form would be enough to
   overwrite another tenant's row: ownership is checked before every write. */
async function assertOwned(userId: string, avatarId: string): Promise<void> {
  if (!(await getAvatar(userId, avatarId))) throw new Error("Avatar not found");
}

export async function saveProfile(userId: string, avatarId: string, profile: BrandProfile): Promise<BrandProfileRow> {
  await assertOwned(userId, avatarId);
  const [row] = await db()
    .insert(schema.brandProfiles)
    .values({ avatarId, userId, profile })
    .onConflictDoUpdate({
      target: schema.brandProfiles.avatarId,
      set: { profile, updatedAt: new Date() },
      setWhere: eq(schema.brandProfiles.userId, userId),
    })
    .returning();
  return row;
}

/** The Brand page's save: profile and brief in one write, so the two never disagree. */
export async function saveBrand(userId: string, avatarId: string, profile: BrandProfile, brief: Brief): Promise<BrandProfileRow> {
  await assertOwned(userId, avatarId);
  const [row] = await db()
    .insert(schema.brandProfiles)
    .values({ avatarId, userId, profile, brief })
    .onConflictDoUpdate({
      target: schema.brandProfiles.avatarId,
      set: { profile, brief, updatedAt: new Date() },
      setWhere: eq(schema.brandProfiles.userId, userId),
    })
    .returning();
  return row;
}

export async function saveBrief(userId: string, avatarId: string, brief: Brief): Promise<BrandProfileRow> {
  await assertOwned(userId, avatarId);
  const [row] = await db()
    .insert(schema.brandProfiles)
    .values({ avatarId, userId, profile: await getProfile(userId, avatarId), brief })
    .onConflictDoUpdate({
      target: schema.brandProfiles.avatarId,
      set: { brief, updatedAt: new Date() },
      setWhere: eq(schema.brandProfiles.userId, userId),
    })
    .returning();
  return row;
}

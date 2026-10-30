import { eq } from "drizzle-orm";

import { alreadySetUp } from "@/app/onboarding/flow";
import { db, schema } from "@/db/client";
import { nextStep, parse, serialise, type InterviewState, type Setup } from "@/onboarding/state";
import type { PhotoStyle } from "@/style/photo-style";

import { getAvatar, listReferences, primaryAvatar } from "./avatars";
import { getProfile, profileComplete } from "./brand";
import { listMedia } from "./media";

/* The setup interview's own repository.

   `onboarding_sessions.state` holds the InterviewState the engine defines, and
   the screens need a little more than the engine does: which avatar the photos
   belong to, and that consent was recorded before a byte was uploaded. Those
   live under a single `ui` key beside it. The engine's own `parse()` ignores unknown keys,
   so the column still reads exactly as the schema says it does. */

export type Consent = {
  /** ISO timestamp. 'self' is a twin: these photos are of me. */
  kind: "self" | "rights";
  at: string;
};

/* Structural rather than imported from src/app: a repository must not depend on
   a screen. src/app/onboarding/roles.ts validates every field of it anyway. */
export type StoredProposal = { mediaId: string; role: string | null; confidence: number; note: string };

export type OnboardingUi = {
  /** The avatar the photos, references and lock hang off. */
  avatarId: string | null;
  consent?: Consent;
  /** What the curation pass proposed, kept so a reload does not re-read the
      photos and quietly rearrange a set she has already tapped. */
  proposals?: StoredProposal[];
  /** Set when this run only swaps the reference photos of an avatar that is already set up
      (the photo style her new set is drawn in). It never reaches the interview. */
  replacing?: { style: PhotoStyle };
};

export type OnboardingSession = {
  userId: string;
  stage: string;
  interview: InterviewState;
  ui: OnboardingUi;
  completedAt: Date | null;
};

const EMPTY_UI: OnboardingUi = { avatarId: null };

function readUi(state: unknown): OnboardingUi {
  const ui = (state as { ui?: Partial<OnboardingUi> } | null)?.ui;
  return { ...EMPTY_UI, ...(ui ?? {}) };
}

export async function getSession(userId: string): Promise<OnboardingSession | null> {
  const [row] = await db()
    .select()
    .from(schema.onboardingSessions)
    .where(eq(schema.onboardingSessions.userId, userId))
    .limit(1);
  if (!row) return null;
  return {
    userId: row.userId,
    stage: row.step,
    interview: parse(row.state),
    ui: readUi(row.state),
    completedAt: row.completedAt,
  };
}

/** One write per answer: the session survives a closed tab and a dead phone. */
export async function saveSession(
  userId: string,
  input: { stage: string; interview: InterviewState; ui: OnboardingUi },
): Promise<void> {
  // Re-serialising through the engine keeps anything malformed out of the column.
  const state = { ...JSON.parse(serialise(input.interview)), ui: input.ui };
  await db()
    .insert(schema.onboardingSessions)
    .values({ userId, step: input.stage, state })
    .onConflictDoUpdate({
      target: schema.onboardingSessions.userId,
      set: { step: input.stage, state, updatedAt: new Date() },
    });
}

/**
 * Start setup again, for another avatar. The one row per account is replaced
 * outright — the finished session has nothing left to say — and `completedAt`
 * is cleared, which is what lets a finished account back into the screens
 * (`gateDecision`'s `setupInProgress`) until this run is completed too.
 */
export async function beginSession(
  userId: string,
  input: { stage: string; interview: InterviewState; ui: OnboardingUi },
): Promise<void> {
  const state = { ...JSON.parse(serialise(input.interview)), ui: input.ui };
  const now = new Date();
  await db()
    .insert(schema.onboardingSessions)
    .values({ userId, step: input.stage, state })
    .onConflictDoUpdate({
      target: schema.onboardingSessions.userId,
      set: { step: input.stage, state, completedAt: null, updatedAt: now },
    });
}

export async function completeSession(userId: string, at: Date = new Date()): Promise<void> {
  await db()
    .update(schema.onboardingSessions)
    .set({ completedAt: at, step: "done", updatedAt: at })
    .where(eq(schema.onboardingSessions.userId, userId));
}

/** The one write that lets a person out of setup. */
export async function setOnboarded(userId: string, at: Date = new Date()): Promise<void> {
  await db()
    .update(schema.users)
    .set({ onboardedAt: at, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
}

/** Setup can be reopened from the Brand page later; this is what undoes the gate
    exemption if an account is ever reset. Kept beside the setter so the two
    columns are never touched from anywhere else. */
export async function clearOnboarded(userId: string): Promise<void> {
  await db()
    .update(schema.users)
    .set({ onboardedAt: null, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
}

/* An account that predates the setup interview has an avatar, a lock, a
   reference set and a filled-in brand profile, and a null onboarded_at, because
   nothing ever wrote that column. It has done everything setup asks for, so the
   column is filled in the first time it is noticed rather than marching a
   working account through an interview it has already answered. Three reads,
   and only for accounts the gate would otherwise stop. */
export async function backfillOnboarded(userId: string): Promise<Date | null> {
  /* An account that is part-way through the interview is not a legacy account,
     whatever it happens to own. This guard is what makes the last screen of
     setup reachable at all: the review screen saves the brand profile, at
     which point the pieces below are all present, and without this the very
     next render would decide the account was already set up and the gate would
     bounce it off the free-photo screen it was on its way to. The flow decides
     where an interview in progress is; this only rescues accounts that never
     had one. `completeSession` is called by the button that leaves the last
     screen, so that is the moment this becomes eligible again. */
  const session = await getSession(userId);
  if (session && !session.completedAt) return null;

  const avatar = await primaryAvatar(userId);
  if (!avatar?.lock) return null;
  const [references, profile] = await Promise.all([
    listReferences(userId, avatar.id),
    getProfile(userId, avatar.id),
  ]);
  if (!alreadySetUp({ hasLock: true, references: references.length, brandComplete: profileComplete(profile) })) {
    return null;
  }
  const at = new Date();
  await setOnboarded(userId, at);
  return at;
}

export type SetupInput = Setup;

/** Photos she uploaded for this avatar, oldest first: the order she added them
    is the order she recognises them in. */
export async function listUploads(userId: string, avatarId: string | null) {
  if (!avatarId) return [];
  const rows = await listMedia(userId, "upload", { avatarId, limit: 60, liveOnly: true });
  return [...rows].reverse();
}

export async function countReferences(userId: string, avatarId: string | null): Promise<number> {
  if (!avatarId) return 0;
  return (await listReferences(userId, avatarId)).length;
}

/** Everything the flow needs to decide where she is, in one round trip's worth
    of queries. */
export async function flowStateFor(userId: string): Promise<{
  session: OnboardingSession | null;
  uploads: Awaited<ReturnType<typeof listUploads>>;
  references: number;
  flow: {
    hasSession: boolean;
    uploads: number;
    references: number;
    nextStep: ReturnType<typeof nextStep>;
    reviewed: boolean;
  };
}> {
  const session = await getSession(userId);
  const avatarId = session?.ui.avatarId ?? null;
  /* A replacing run starts with no photos and no set as far as the flow can
     see: the old photos are retired and the new set is what the two photo
     screens are about. The avatar keeps using its old references until the new
     set is saved. */
  const [uploads, references, profile] = await Promise.all([
    listUploads(userId, avatarId),
    session?.ui.replacing ? Promise.resolve(0) : countReferences(userId, avatarId),
    getProfile(userId, avatarId),
  ]);
  return {
    session,
    uploads,
    references,
    flow: {
      hasSession: Boolean(session),
      uploads: uploads.length,
      references,
      nextStep: session ? nextStep(session.interview) : null,
      /* Derived, like every other position in the flow, rather than read off a
         cursor: the review screen's only lasting effect is the saved brand
         profile, so that is what says it has been submitted. A setup that died
         after saving it reopens past the review screen, which is correct — the
         answers are all in. */
      reviewed: profileComplete(profile),
    },
  };
}

/** Replaces the whole curated set in one go: the screen submits all five roles
    at once, and a half-applied change would leave her looking like two people.
    Every id in `assignments` is checked against this user's own media first, so
    a hand-edited form cannot point her reference set at another tenant's bytes. */
export async function replaceReferences(
  userId: string,
  avatarId: string,
  assignments: { mediaId: string; role: (typeof schema.avatarReferences.$inferInsert)["role"]; position: number }[],
): Promise<void> {
  if (!(await getAvatar(userId, avatarId))) throw new Error("Avatar not found");
  const owned = new Set((await listUploads(userId, avatarId)).map((row) => row.id));
  const safe = assignments.filter((item) => owned.has(item.mediaId));
  if (safe.length !== assignments.length) throw new Error("One of those photos is not yours.");

  await db().delete(schema.avatarReferences).where(eq(schema.avatarReferences.avatarId, avatarId));
  if (safe.length === 0) return;
  await db()
    .insert(schema.avatarReferences)
    .values(
      safe.map((item) => ({
        avatarId,
        mediaId: item.mediaId,
        role: item.role,
        // Originals only: onboarding never generates a view, so nothing needs approving.
        source: "original" as const,
        approved: true,
        position: item.position,
      })),
    );
}

/** She has read the note that says setup is finished; Overview stops showing it. */
export async function setSetupSeen(userId: string, at: Date = new Date()): Promise<void> {
  await db()
    .update(schema.users)
    .set({ setupSeenAt: at, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
}

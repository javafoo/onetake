"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionState } from "@/app/actions";
import { createAvatar, getAvatar, primaryAvatar, updateAvatar } from "@/data/avatars";
import { saveBrief, saveProfile } from "@/data/brand";
import { deleteMedia, readMedia } from "@/data/media";
import {
  completeSession,
  flowStateFor,
  getSession,
  replaceReferences,
  saveSession,
  setOnboarded,
  type OnboardingSession,
  type OnboardingUi,
} from "@/data/onboarding";
import { type User } from "@/data/users";
import type { IdentityLock } from "@/identity/build";
import { startFreePhoto } from "@/jobs/free-photo";
import { compile } from "@/onboarding/compile";
import { draftLock, rebuildLock } from "@/onboarding/lock";
import {
  answerText,
  nextStep,
  recordAnswer,
  start,
  type AnswerValue,
  type AnyAnswerValue,
  type InterviewState,
  type Setup,
} from "@/onboarding/state";
import { STEP_IDS, type StepId } from "@/onboarding/steps";
import { languageField, normaliseLanguage } from "@/content/languages";
import { guardedAction } from "@/lib/action-guard";
import { InvalidRequestError } from "@/lib/errors";
import { withModelSpend } from "@/spend";

import { MIN_PHOTOS, resumePath, resumeStage, stagePath, type Stage } from "./flow";
import { assignmentsFromForm, isRole, ROLE_ORDER } from "./roles";
import { untracedIn } from "./untraced";
import { MAX_PROOF_POINTS, proofProblems } from "@/onboarding/proof";

/* The setup interview's server actions. They live here rather than in
   src/app/actions.ts so this whole feature is one folder.

   Every one of them is free to her. All but one are free in the narrow sense
   too — text and vision calls, nothing that reserves credits. The exception is
   the last screen's free photo, which starts a real `image` job priced at zero
   against a claim taken off the `users` row. Nothing in setup touches the
   credit ledger, and that is still true: a job priced at zero writes no rows. */

/* Everything the rest of the app's ActionState carries, plus the one thing only
   this feature has: a pushback is not a success and not an error, it is the
   coach asking a better question, and the screen draws it differently. */
export type SetupState = { ok: boolean; message: string; pushback?: string; sharper?: string } | null;

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const lines = (form: FormData, key: string) =>
  text(form, key).split("\n").map((line) => line.trim()).filter(Boolean);

type Outcome = string | { ok?: boolean; message: string; pushback?: string; sharper?: string };

/* The same retry guard the rest of the app uses, from `@/lib/action-guard`:
   free work still must not run twice — two answers recorded for one tap would
   move the cursor past a step she never saw. */
function guarded(where: string, form: FormData, run: (user: User) => Promise<Outcome>): Promise<SetupState> {
  return guardedAction<Outcome, SetupState>(form, {
    where,
    run,
    done: (outcome) =>
      typeof outcome === "string" ? { ok: true, message: outcome } : { ok: outcome.ok ?? true, ...outcome },
    failed: (message) => ({ ok: false, message }),
  });
}

/** Every action past the first screen needs the session and the avatar it hangs
    off. One missing means setup was reset in another tab. */
async function openSession(userId: string): Promise<{ session: OnboardingSession; avatarId: string }> {
  const session = await getSession(userId);
  if (!session) throw new InvalidRequestError("Setup has not started yet. Go back to the first screen.");
  const avatarId = session.ui.avatarId;
  if (!avatarId || !(await getAvatar(userId, avatarId))) {
    throw new InvalidRequestError("We lost track of her. Go back to the first screen.");
  }
  return { session, avatarId };
}

async function write(
  userId: string,
  session: OnboardingSession,
  patch: { interview?: InterviewState; ui?: Partial<OnboardingUi>; stage?: Stage | "done" },
): Promise<void> {
  const interview = patch.interview ?? session.interview;
  const ui = { ...session.ui, ...(patch.ui ?? {}) };
  await saveSession(userId, { stage: patch.stage ?? session.stage, interview, ui });
}

/* ---------------------------------------------------------------------------
   1. Welcome: her name, her niche, and whose face this is.
   ------------------------------------------------------------------------- */

export async function startSetupAction(_: SetupState, form: FormData): Promise<SetupState> {
  const state = await guarded("startSetupAction", form, async (user) => {
    const personaName = text(form, "personaName");
    const niche = text(form, "niche");
    const kind = text(form, "avatarKind");
    // Checked against the list, never taken as typed: anything unknown is English.
    const language = normaliseLanguage(text(form, "language"));
    if (!personaName) throw new InvalidRequestError("Give her a name. It is the name on the account.");
    if (!niche) throw new InvalidRequestError("Say what the account is about, in one line.");
    if (kind !== "twin" && kind !== "avatar") throw new InvalidRequestError("Pick whose face this is.");

    const setup: Setup = { avatarKind: kind, personaName, niche, ...languageField(language) };
    const existing = await getSession(user.id);

    /* One avatar per account for now. Reusing it means coming back to change
       her name does not strand the photos she already uploaded. */
    const avatar =
      (existing?.ui.avatarId ? await getAvatar(user.id, existing.ui.avatarId) : null) ??
      (await primaryAvatar(user.id)) ??
      (await createAvatar(user.id, { name: personaName, kind }));
    await updateAvatar(user.id, avatar.id, { name: personaName, kind });

    const interview = existing ? { ...existing.interview, setup, updatedAt: new Date().toISOString() } : start(setup);
    await saveSession(user.id, {
      stage: "photos",
      interview,
      ui: { ...(existing?.ui ?? { avatarId: null }), avatarId: avatar.id },
    });
    return "Saved.";
  });
  if (state?.ok) redirect("/onboarding/photos");
  return state;
}

/* ---------------------------------------------------------------------------
   2. Her face: consent, then photos, then which photo plays which part.
   ------------------------------------------------------------------------- */

export async function recordConsentAction(_: SetupState, form: FormData): Promise<SetupState> {
  return guarded("recordConsentAction", form, async (user) => {
    const { session, avatarId } = await openSession(user.id);
    const kind = session.interview.setup.avatarKind;
    const at = new Date();

    /* A twin is the user's own face, and that consent is a column on the avatar
       because every later generation has to be able to check it. Rights over
       someone else's images are a different promise and are recorded here. */
    if (kind === "twin") await updateAvatar(user.id, avatarId, { likenessConsentAt: at });
    await write(user.id, session, {
      ui: { consent: { kind: kind === "twin" ? "self" : "rights", at: at.toISOString() } },
      stage: "photos",
    });
    revalidatePath("/onboarding/photos");
    return "Thank you. You can add her photos now.";
  });
}

export async function removePhotoAction(_: SetupState, form: FormData): Promise<SetupState> {
  return guarded("removePhotoAction", form, async (user) => {
    const { session } = await openSession(user.id);
    const mediaId = text(form, "mediaId");
    const { uploads } = await flowStateFor(user.id);
    if (!uploads.some((row) => row.id === mediaId)) throw new InvalidRequestError("That photo is not one of hers.");
    /* avatar_references is cascaded from media, so a photo that was already in
       the curated set leaves it as the bytes go. */
    await deleteMedia(user.id, mediaId);
    await write(user.id, session, { stage: "photos" });
    revalidatePath("/onboarding/photos");
    return "Removed.";
  });
}

/** The little cross on a thumbnail: a plain form action, because a failed
    delete leaves the photo on screen and trying again is the whole recovery. */
export async function removePhotoFormAction(form: FormData): Promise<void> {
  await removePhotoAction(null, form);
}

export async function saveRolesAction(_: SetupState, form: FormData): Promise<SetupState> {
  let replaced = false;
  const state = await guarded("saveRolesAction", form, async (user) => {
    const { session, avatarId } = await openSession(user.id);
    const uploads = (await flowStateFor(user.id)).uploads;

    const picked: Partial<Record<string, string>> = {};
    for (const role of ROLE_ORDER) picked[role] = text(form, role);
    const assignments = assignmentsFromForm(
      Object.fromEntries(Object.entries(picked).filter(([role]) => isRole(role))),
      uploads.map((row) => row.id),
    );
    if (!assignments.some((item) => item.role === "front")) {
      throw new InvalidRequestError("Pick the photo where she is looking at the camera. That one sets the look.");
    }

    /* A replacing run saves the new set only once its description has been
       written, so a failed vision call leaves her old set and description as
       they were instead of new photos under an old description. */
    const replacing = session.ui.replacing ?? null;
    if (!replacing) await replaceReferences(user.id, avatarId, assignments);

    /* The lock is read off the photos she just chose, so it describes the set
       that will actually be sent to the image model. About twenty seconds of
       vision call, and free. */
    const images = await Promise.all(
      assignments.map(async (item) => ({
        mimeType: uploads.find((row) => row.id === item.mediaId)?.contentType ?? "image/jpeg",
        data: await readMedia(user.id, item.mediaId),
      })),
    );
    /* A vision call over every photo she chose: free to her, not free to us,
       and the one call in setup a script could aim at fifteen images at a
       time. Counted as one setup step per photo. */
    const drafted: IdentityLock = await withModelSpend(
      user,
      { limit: "onboarding", shape: "onboarding_lock", cost: images.length },
      () => draftLock(images, replacing ? { style: replacing.style } : {}),
    );
    if (replacing) {
      /* A new set for an avatar that is already set up: her description is
         written again from the new photos, in the style she picked, and the
         words her past photos taught us to avoid are kept. Nothing else of
         hers is touched, and the run ends here rather than walking her back
         through the interview. */
      await replaceReferences(user.id, avatarId, assignments);
      const avatar = await getAvatar(user.id, avatarId);
      await updateAvatar(user.id, avatarId, { lock: rebuildLock((avatar?.lock ?? null) as IdentityLock | null, drafted) });
      await completeSession(user.id);
      replaced = true;
      revalidatePath("/", "layout");
      return "Saved.";
    }
    await updateAvatar(user.id, avatarId, { lock: drafted });
    await write(user.id, session, { stage: STEP_IDS[0] });
    revalidatePath("/", "layout");
    return "Saved.";
  });
  if (state?.ok) redirect(replaced ? "/avatar" : stagePath(STEP_IDS[0]));
  return state;
}

/* ---------------------------------------------------------------------------
   3. The interview.
   ------------------------------------------------------------------------- */

function answerFrom(form: FormData, id: StepId): AnyAnswerValue {
  switch (id) {
    case "offer": {
      const value = text(form, "text");
      const keyword = text(form, "keyword");
      if (!value) throw new InvalidRequestError("Say what it is and what it costs.");
      if (!keyword) throw new InvalidRequestError("Pick the one word people comment.");
      if (/\s/.test(keyword)) throw new InvalidRequestError("The keyword is one word, with no spaces.");
      return { text: value, keyword: keyword.toUpperCase() };
    }
    case "story": {
      const before = text(form, "before");
      const turn = text(form, "turn");
      const now = text(form, "now");
      if (!before || !turn || !now) throw new InvalidRequestError("All three beats, even if one of them is a single sentence.");
      return { before, turn, now };
    }
    case "proof": {
      const points = lines(form, "points");
      if (points.length === 0) throw new InvalidRequestError("Type at least one thing you could show a screenshot of.");
      if (points.length > MAX_PROOF_POINTS) throw new InvalidRequestError(`Up to ${MAX_PROOF_POINTS} facts. Keep the strongest.`);
      const problems = proofProblems(points);
      if (problems.length) throw new InvalidRequestError(`"${problems[0].line.slice(0, 60)}${problems[0].line.length > 60 ? "…" : ""}": ${problems[0].reason}`);
      return { points };
    }
    case "voice": {
      const label = text(form, "label");
      const caption = text(form, "caption");
      if (!label || !caption) throw new InvalidRequestError("Describe your voice in a few words and write one caption.");
      return { label, caption, is: lines(form, "is"), isNot: lines(form, "isNot") };
    }
    default: {
      const value = text(form, "text");
      if (!value) throw new InvalidRequestError("Write an answer in your own words.");
      return { text: value };
    }
  }
}

export async function answerStepAction(_: SetupState, form: FormData): Promise<SetupState> {
  let next: string | null = null;
  const state = await guarded("answerStepAction", form, async (user) => {
    const { session } = await openSession(user.id);
    const id = text(form, "step") as StepId;
    if (!STEP_IDS.includes(id)) throw new InvalidRequestError("Unknown step.");

    const value = answerFrom(form, id);
    const source = text(form, "source");
    /* Proof is the only place a number may enter the brand, and the schema
       itself refuses anything that did not come off her keyboard. */
    const recorded =
      id === "proof" ? "typed" : source === "picked" || source === "edited" ? source : "typed";

    /* A suggestion she only tapped is not her word, so any number in it is
       nobody's. compile() refuses such a brief at the very end; catching it
       here means she hears about it while the sentence is still on screen
       rather than three steps later with no idea which line caused it. */
    if (recorded === "picked") {
      const loose = untracedIn(session.interview, answerText(id, value as AnswerValue<typeof id>));
      if (loose.length) {
        throw new InvalidRequestError(
          `That suggestion contains ${loose.join(", ")}, which you have not typed anywhere. ` +
            "Change it to something you could show a screenshot of, or take the number out.",
        );
      }
    }

    const interview = recordAnswer(session.interview, id, value as AnswerValue<typeof id>, recorded);
    /* The photos are already done by the time any of this runs, so the only
       thing left to decide is which step is next, or the review screen. */
    const ahead = { hasSession: true, uploads: MIN_PHOTOS, references: 1, nextStep: nextStep(interview) };
    await write(user.id, session, { interview, stage: resumeStage(ahead) });
    next = resumePath(ahead);
    revalidatePath("/onboarding", "layout");
    return "Saved.";
  });
  if (state?.ok && next) redirect(next);
  return state;
}

/* ---------------------------------------------------------------------------
   4. Review, and 5. finish.
   ------------------------------------------------------------------------- */

/** Edits on the review screen go back into the answers they were compiled from,
    so the brief and the profile can never drift apart from what she said. */
export async function reviseAnswersAction(_: SetupState, form: FormData): Promise<SetupState> {
  return guarded("reviseAnswersAction", form, async (user) => {
    const { session } = await openSession(user.id);
    let interview = session.interview;
    let changed = 0;

    for (const id of STEP_IDS) {
      if (!interview.answers[id]) continue;
      if (form.get(`${id}.present`) === null) continue;
      const value = answerFrom(prefixed(form, id), id);
      const before = JSON.stringify(stripMeta(interview.answers[id]));
      if (JSON.stringify(value) === before) continue;
      interview = recordAnswer(interview, id, value as AnswerValue<typeof id>, "edited");
      changed += 1;
    }

    if (changed === 0) return "Nothing to change.";
    await write(user.id, session, { interview, stage: "review" });
    revalidatePath("/onboarding/review");
    return changed === 1 ? "One line updated." : `${changed} lines updated.`;
  });
}

/** The review screen namespaces its inputs so seven answers can share one form. */
function prefixed(form: FormData, id: StepId): FormData {
  const out = new FormData();
  for (const [key, value] of form.entries()) {
    if (key.startsWith(`${id}.`)) out.append(key.slice(id.length + 1), value);
  }
  return out;
}

/** An answer without the bookkeeping, so it can be compared with what the form
    sent and an unchanged box does not count as an edit. */
function stripMeta(answer: object): object {
  const rest = { ...(answer as Record<string, unknown>) };
  delete rest.source;
  delete rest.at;
  return rest;
}

export async function saveLockAction(_: SetupState, form: FormData): Promise<SetupState> {
  return guarded("saveLockAction", form, async (user) => {
    const { avatarId } = await openSession(user.id);
    const avatar = await getAvatar(user.id, avatarId);
    const existing = (avatar?.lock ?? null) as IdentityLock | null;
    if (!existing) throw new InvalidRequestError("There is no description to edit yet.");

    const lock: IdentityLock = {
      subject: text(form, "subject") || existing.subject,
      hair: text(form, "hair") || existing.hair,
      skinMakeup: text(form, "skinMakeup") || existing.skinMakeup,
      accessories: text(form, "accessories") || existing.accessories,
      expressions: text(form, "expressions") || existing.expressions,
      wardrobe: lines(form, "wardrobe"),
      scenes: lines(form, "scenes"),
      bannedWords: existing.bannedWords ?? [],
      ...(existing.photoStyle ? { photoStyle: existing.photoStyle } : {}),
    };
    await updateAvatar(user.id, avatarId, { lock });
    revalidatePath("/onboarding/review");
    return "Her description is saved.";
  });
}

/**
 * The review screen's button: save everything she said, then go and take her
 * first photo.
 *
 * This no longer finishes setup. The brand profile and the brief are written —
 * which is what `flowStateFor` reads back as "reviewed" — and the run moves to
 * the free photo, which is the last screen. `setOnboarded` is deliberately not
 * called here: it is the write that lets a person out of setup, and calling it
 * before the last screen would have the gate bounce her straight off it.
 */
export async function finishSetupAction(_: SetupState, form: FormData): Promise<SetupState> {
  const state = await guarded("finishSetupAction", form, async (user) => {
    const { session, avatarId } = await openSession(user.id);

    /* compile() refuses to hand back a brief containing a number she never
       typed, so this is also the last check that nothing was invented. */
    const { profile, brief } = compile(session.interview);
    await updateAvatar(user.id, avatarId, {
      name: session.interview.setup.personaName,
      kind: session.interview.setup.avatarKind,
    });
    await saveProfile(user.id, avatarId, profile);
    await saveBrief(user.id, avatarId, brief);
    await write(user.id, session, { stage: "first-photo" });

    revalidatePath("/", "layout");
    return "Set up.";
  });
  if (state?.ok) redirect(stagePath("first-photo"));
  return state;
}

/* ---------------------------------------------------------------------------
   6. Her first photo: one free generation, then out into the app.
   ------------------------------------------------------------------------- */

/**
 * Generate the account's one free photo.
 *
 * Thin on purpose: the rules for who may have one, and the order the checks
 * run in, live in `@/jobs/free-photo` because the Library offers the same gift
 * to accounts that were set up before this screen existed, and the two must
 * not be able to disagree.
 */
export async function generateFirstPhotoAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guardedAction<{ message: string; jobId: string }, ActionState>(form, {
    where: "generateFirstPhotoAction",
    run: async (user, requestId) => {
      const session = await getSession(user.id);
      const job = await startFreePhoto(user, { idea: text(form, "idea"), requestId, avatarId: session?.ui.avatarId ?? null });
      return { message: "Making her first photo. This takes about a minute.", jobId: job.id };
    },
    done: (outcome) => ({ ok: true, ...outcome }),
    failed: (message) => ({ ok: false, message }),
  });
}

/**
 * Leave setup for the app.
 *
 * This is the write that lets her out, and it is the same one whether she took
 * the photo or skipped it. Skipping keeps the freebie: it is hers for the
 * lifetime of the account, and the Library offers it again until it is spent.
 */
export async function openOverviewAction(_: SetupState, form: FormData): Promise<SetupState> {
  const state = await guarded("openOverviewAction", form, async (user) => {
    await completeSession(user.id);
    await setOnboarded(user.id);
    revalidatePath("/", "layout");
    return "Set up.";
  });
  if (state?.ok) redirect("/");
  return state;
}

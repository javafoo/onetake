"use server";

import { revalidatePath } from "next/cache";

import { buildBriefFrom, type Brief } from "@/brief/build";
import { applyBrandForm } from "@/brief/sync";
import { requireClipAspectRatio, requireClipModel, requireRatioForModel } from "@/content/clip-options";
import { normalizeImageAspect } from "@/content/image-options";
import { normalizeHex } from "@/content/keyword-color";
import { MAX_OFFERS, readOfferRows } from "@/content/offers";
import { normalizeTextStyle } from "@/content/text-styles";
import { type Dropped } from "@/content/motion";
import { motionIdeasFor, sceneOf } from "@/content/motion-ideas";
import { polishMotion } from "@/content/motion-polish";
import { buildIdea } from "@/content/scene-library";
import { approveReference, ensurePrimaryAvatar, identityLock } from "@/data/avatars";
import { languageField } from "@/content/languages";
import { getBrief, getProfile, saveBrand, saveBrief } from "@/data/brand";
import { applyDraftEdit, getDraft } from "@/data/drafts";
import { requireOwnFolder } from "@/data/folders";
import { setSetupSeen } from "@/data/onboarding";
import { getMedia } from "@/data/media";
import { requireUser, type User } from "@/data/users";
import { startJob } from "@/jobs";
import { startFreePhoto } from "@/jobs/free-photo";
import { guardedAction } from "@/lib/action-guard";
import { currentAvatar } from "@/lib/current-avatar";
import { InvalidRequestError } from "@/lib/errors";
import { refuse } from "@/safety/refusals";
import { screenSceneIdea } from "@/safety/screen";
import { withModelSpend } from "@/spend";
import { SHOT_LABEL, type ShotType } from "@/style/shot-types";

/** `jobId` is set by the actions that start slow work. Poll it with `<JobStatus>`. */
export type ActionState = { ok: boolean; message: string; jobId?: string } | null;

/** What an action hands back: a sentence, plus a job to watch if it started one. */
type Outcome = string | { message: string; jobId?: string };

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const lines = (form: FormData, key: string) =>
  text(form, key).split("\n").map((line) => line.trim()).filter(Boolean);

/* The session check, the per-account retry guard and the error taxonomy all
   live in `@/lib/action-guard`; this is only the shape this file's actions
   hand back. */
function guarded(where: string, form: FormData, run: (user: User, requestId: string) => Promise<Outcome>): Promise<ActionState> {
  return guardedAction<Outcome, ActionState>(form, {
    where,
    run,
    done: (outcome) => (typeof outcome === "string" ? { ok: true, message: outcome } : { ok: true, ...outcome }),
    failed: (message) => ({ ok: false, message }),
  });
}

/** Every generating action needs an avatar with a lock; this is the one message that says so. */
async function lockedAvatar(userId: string) {
  const avatar = await currentAvatar(userId);
  const lock = identityLock(avatar);
  if (!avatar || !lock) throw new InvalidRequestError("Her description is not saved yet. Finish her setup first.");
  return { avatar, lock };
}

export async function saveBrandAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded("saveBrandAction", form, async (user) => {
    const personaName = text(form, "personaName");
    // The brand profile hangs off an avatar, so saving this page creates one on a fresh account.
    const avatar = await ensurePrimaryAvatar(user.id, personaName);
    const [before, existing] = await Promise.all([getProfile(user.id, avatar.id), getBrief(user.id, avatar.id)]);
    const keyword = text(form, "keyword").toUpperCase();
    const rows = Array.from({ length: MAX_OFFERS - 1 }, (_, index) => ({ offer: text(form, `offer${index + 2}`), keyword: text(form, `keyword${index + 2}`) }));
    const read = readOfferRows(rows, keyword);
    if ("error" in read) throw new InvalidRequestError(read.error);
    // An empty or unknown value is no colour: each look draws the keyword its own way, as before.
    const keywordColor = normalizeHex(text(form, "keywordColor"));
    // A link sticker opens it in someone's browser, so only a web address is kept.
    const link = text(form, "link").slice(0, 300);
    if (link && !/^https?:\/\/\S+$/i.test(link)) throw new InvalidRequestError("The link needs to be a web address starting with https://");
    const { profile, brief } = applyBrandForm(existing, before, {
      profile: {
        personaName,
        niche: text(form, "niche"),
        audience: text(form, "audience"),
        offer: text(form, "offer"),
        keyword,
        ...(read.offers.length ? { offers: read.offers } : {}),
        ...(keywordColor ? { keywordColor } : {}),
        ...(link ? { link } : {}),
        ...(form.get("affiliate") === "yes" ? { affiliate: true } : {}),
        voice: text(form, "voice"),
        proofPoints: lines(form, "proofPoints"),
        winners: lines(form, "winners"),
        // Checked against the list: an unknown value is English, and English is stored as no field at all.
        ...languageField(text(form, "language")),
      },
      story: { before: text(form, "storyBefore"), turn: text(form, "storyTurn"), now: text(form, "storyNow") },
      problem: lines(form, "problem"),
      pointOfView: lines(form, "pointOfView"),
    });
    await saveBrand(user.id, avatar.id, profile, brief);
    revalidatePath("/", "layout");
    return "Brand saved. The brief is updated too.";
  });
}

/** The "you are set up" note on Overview, read once. A plain form action: nothing to report back. */
export async function dismissSetupNoteAction(): Promise<void> {
  const user = await requireUser();
  await setSetupSeen(user.id);
  revalidatePath("/");
}

export async function approveReferenceAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded("approveReferenceAction", form, async (user) => {
    const reference = await approveReference(user.id, text(form, "referenceId"));
    if (!reference) throw new InvalidRequestError("That photo is gone. Reload the page.");
    revalidatePath("/", "layout");
    return "Approved.";
  });
}

export async function generateSceneAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded("generateSceneAction", form, async (user, requestId) => {
    if (text(form, "idea").length < 8) throw new InvalidRequestError("Pick a scene, or say where she is and what she is doing.");
    const pick = (key: string) => text(form, key).slice(0, 120);
    const idea = buildIdea({ idea: text(form, "idea"), outfit: pick("outfit"), expression: pick("expression"), light: pick("light") });
    const shot = text(form, "shot") as ShotType;
    if (!(shot in SHOT_LABEL)) throw new InvalidRequestError("Pick a shot type.");
    const aspect = normalizeImageAspect(text(form, "aspect"));

    // Checked here so the person hears about a missing lock now, not in a failed job.
    const { avatar } = await lockedAvatar(user.id);

    /* The scene idea is checked before the job exists, so a refusal is a
       sentence on the page she is looking at rather than a failed job she has
       to go and find. The photographs are checked again inside the job, right
       before anything is drawn. */
    const verdict = await withModelSpend(user, { limit: "vision", shape: "screen_idea" }, () =>
      screenSceneIdea(idea));
    if (!verdict.ok) await refuse(user.id, "scene_idea", verdict);
    // The folder that was open when she pressed the button is where the photo lands.
    const folderId = await requireOwnFolder(user.id, form.get("folder"));
    const job = await startJob(user, {
      kind: "image",
      avatarId: avatar.id,
      requestId,
      input: { kind: "image", idea, shot, aspect, folderId: folderId ?? null },
    });
    return { message: "Making your photo. This takes about a minute.", jobId: job.id };
  });
}

export async function assembleAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded("assembleAction", form, async (user, requestId) => {
    const draft = await getDraft(user.id, text(form, "id"));
    if (!draft) throw new InvalidRequestError("That draft is gone. Reload the page.");
    const clip = await getMedia(user.id, text(form, "clip"));
    if (!clip || clip.kind !== "clip") throw new InvalidRequestError("Pick a clip from the library.");

    /* A reel the agent made may carry a second line and be a talking reel;
       rebuilding it on another clip keeps both, read off the reel it replaces. */
    const previous = draft.outputMediaId ? await getMedia(user.id, draft.outputMediaId) : null;
    const previousMeta = (previous?.meta ?? {}) as { cue?: { text?: unknown } | null; mode?: unknown; style?: unknown };
    const cue = typeof previousMeta.cue?.text === "string" ? previousMeta.cue.text : undefined;
    // Reels made before the five looks carry "box" or "elegant"; the same look is kept.
    const style = previousMeta.style === undefined ? undefined : normalizeTextStyle(previousMeta.style);
    const talking = (clip.meta as { speech?: unknown }).speech === true;

    const job = await startJob(user, {
      kind: "reel",
      avatarId: draft.avatarId,
      requestId,
      input: { kind: "reel", draftId: draft.id, clipMediaId: clip.id, ...(cue ? { cue } : {}), ...(talking ? { mode: "talking" as const } : {}), ...(style ? { style } : {}) },
    });
    return { message: "Assembling the reel. This takes under a minute.", jobId: job.id };
  });
}

export async function rebuildBriefAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded("rebuildBriefAction", form, async (user) => {
    const avatar = await currentAvatar(user.id);
    if (!avatar) throw new InvalidRequestError("Fill in the Brand page first.");
    const existing: Brief | null = await getBrief(user.id, avatar.id);
    const paths = (existing?.sources ?? []).map((source) => source.path);
    if (paths.length === 0) throw new InvalidRequestError("No source documents are set for this brief. Uploading them comes with onboarding.");
    const brief = await withModelSpend(user, { limit: "brief", shape: "rebuild_brief" }, () =>
      buildBriefFrom(paths));
    await saveBrief(user.id, avatar.id, brief);
    revalidatePath("/", "layout");
    return brief.conflicts.length ? `Rebuilt. ${brief.conflicts.length} conflicts found.` : "Rebuilt. No conflicts.";
  });
}

/**
 * The free first photo, offered from the Library.
 *
 * The same gift as the last screen of setup, for the accounts that finished
 * setup before that screen existed and for anyone who skipped it. The rules
 * live in `@/jobs/free-photo` so the two entry points cannot drift apart about
 * who is owed one.
 */
export async function freePhotoAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded("freePhotoAction", form, async (user, requestId) => {
    const avatar = await currentAvatar(user.id);
    const job = await startFreePhoto(user, { idea: text(form, "idea"), requestId, avatarId: avatar?.id ?? null });
    return { message: "Making your free photo. This takes about a minute.", jobId: job.id };
  });
}

/* ------------------------------------------------------------------ */
/* The Animate prompt builder                                          */
/* ------------------------------------------------------------------ */

/**
 * Three suggested movements for one photo.
 *
 * Called straight from the drawer when a tile is tapped — not a form, so it
 * takes a media id rather than a `FormData`. Free, low thinking, limited, and
 * the answer is written onto the photo so the second tap costs nothing.
 */
export type MotionIdeasState = { ok: true; mediaId: string; ideas: string[] } | { ok: false; message: string } | null;

export async function motionIdeasAction(mediaId: string): Promise<MotionIdeasState> {
  const form = new FormData();
  return guardedAction<{ mediaId: string; ideas: string[] }, MotionIdeasState>(form, {
    where: "motionIdeasAction",
    run: async (user) => {
      const image = await getMedia(user.id, mediaId);
      if (!image || image.kind !== "image") throw new InvalidRequestError("Pick a photo to animate.");
      const { lock } = await lockedAvatar(user.id);

      /* The shape is chosen from what this photo carries: a generated one has
         its scene on the row and needs a short text call, an upload has to be
         looked at. Reserving the vision estimate for a text call would count
         four times what we spend against the daily cap. */
      const shape = sceneOf(image) ? "motion_ideas" : "motion_ideas_photo";
      const { ideas } = await withModelSpend(user, { limit: "motion", shape }, () =>
        motionIdeasFor(user.id, image.id, lock));
      return { mediaId: image.id, ideas };
    },
    done: (outcome) => ({ ok: true, ...outcome }),
    failed: (message) => ({ ok: false, message }),
  });
}

/**
 * A rough idea in, the motion prompt out — before any credit is spent.
 *
 * The drawer shows what came back, and what was taken out of it and why, with
 * "Use this" and "Edit". Nothing is submitted here: this call spends no
 * credits and starts no job.
 */
export type PolishState =
  | { ok: true; idea: string; motion: string; dropped: Dropped[] }
  | { ok: false; message: string }
  | null;

export async function polishMotionAction(_: PolishState, form: FormData): Promise<PolishState> {
  return guardedAction<{ idea: string; motion: string; dropped: Dropped[] }, PolishState>(form, {
    where: "polishMotionAction",
    run: async (user) => {
      const idea = text(form, "idea");
      if (idea.length < 8) throw new InvalidRequestError("Say what she does, in a few words.");
      const image = await getMedia(user.id, text(form, "image"));
      if (!image || image.kind !== "image") throw new InvalidRequestError("Pick a photo to animate.");
      const { lock } = await lockedAvatar(user.id);

      const polished = await withModelSpend(user, { limit: "motion", shape: "polish_motion" }, async () => {
        /* A motion prompt is a description of a photograph somebody wants
           made, which is exactly what the scene-idea screen is for. Checked
           here, on the words she typed, before they are rewritten — so a
           refusal names what she wrote rather than what we made of it. */
        const verdict = await screenSceneIdea(idea);
        if (!verdict.ok) await refuse(user.id, "scene_idea", verdict);
        return polishMotion({ idea, expressions: lock.expressions, scene: sceneOf(image) });
      });

      if (!polished) {
        throw new InvalidRequestError(
          "There is no movement left in that once the rules are applied. Describe one small thing she does with her hands or her head.",
        );
      }
      return { idea: polished.idea, motion: polished.motion, dropped: polished.dropped };
    },
    done: (outcome) => ({ ok: true, ...outcome }),
    failed: (message) => ({ ok: false, message }),
  });
}

export async function animateAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded("animateAction", form, async (user, requestId) => {
    const motion = text(form, "motion");
    if (motion.length < 8) throw new InvalidRequestError("Describe one small movement.");
    /* Her own words, kept beside the prompt they became. Empty when she typed
       the final line herself and nothing needed changing. */
    const idea = text(form, "idea").slice(0, 600);
    const image = await getMedia(user.id, text(form, "image"));
    if (!image || image.kind !== "image") throw new InvalidRequestError("Pick a photo to animate.");

    /* Both of these decide what the clip is, so neither is read as "whatever
       the form said". An
       unknown value is refused rather than defaulted: a form that sends
       nonsense is a form we do not understand, and guessing on its behalf is
       how somebody pays for a clip they did not ask for. */
    const model = requireClipModel(form.get("model"));
    const aspectRatio = requireClipAspectRatio(form.get("aspectRatio"));
    requireRatioForModel(model, aspectRatio);

    const { avatar } = await lockedAvatar(user.id);
    /* The line sent to the video model, checked as it will be sent. Polishing
       screens her words too, but polishing is optional and the final line can
       be typed straight in, so this is the check every clip passes. */
    const verdict = await withModelSpend(user, { limit: "vision", shape: "screen_idea" }, () =>
      screenSceneIdea(motion));
    if (!verdict.ok) await refuse(user.id, "scene_idea", verdict);
    /* Where the clip is filed: the folder that was open, or, when none was,
       the photo's own (left undefined here so the job inherits it). */
    const folderId = await requireOwnFolder(user.id, form.get("folder"));
    const job = await startJob(user, {
      kind: "clip",
      avatarId: avatar.id,
      requestId,
      input: {
        kind: "clip",
        imageMediaId: image.id,
        motion,
        ...(idea ? { idea } : {}),
        seconds: 5,
        model,
        aspectRatio,
        ...(folderId !== undefined ? { folderId } : {}),
      },
    });
    return {
      message: `Animating your photo, ${aspectRatio}. Clips usually take two to four minutes.`,
      jobId: job.id,
    };
  });
}

/**
 * Hand-edit a draft: the hook, the caption and the call to action.
 *
 * The same rules the writer holds itself to (`checkDraftEdit`), because a hook
 * that outruns the reel breaks the assembler whoever typed it. If the draft
 * already has a reel, that reel now shows the old hook, so it is marked stale:
 * the status goes back to `draft`, the date comes off the calendar, and the
 * clip she already picked stays chosen so re-assembling is one press. The old
 * reel is left in place until the new one replaces it, so nothing disappears
 * from under her while she is deciding.
 */
export async function editDraftAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guarded("editDraftAction", form, async (user) => {
    /* The ownership check is `applyDraftEdit`'s first line: the row is read
       scoped to this session's user id, so a draft id belonging to somebody
       else is simply not found. */
    const saved = await applyDraftEdit(user.id, text(form, "id"), {
      hook: text(form, "hook"),
      caption: text(form, "caption"),
      cta: text(form, "cta"),
    });
    if (!saved) throw new InvalidRequestError("That draft is gone. Reload the page.");

    revalidatePath("/", "layout");
    return saved.staleReel
      ? "Saved. The reel still has the old hook, so assemble it again before you post it."
      : "Saved.";
  });
}

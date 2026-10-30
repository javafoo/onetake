import "server-only";

import { getAvatar, identityLock, primaryAvatar } from "@/data/avatars";
import { claimFreePhoto, releaseFreePhoto } from "@/data/freebie";
import { hasVerifiedEmail, type User } from "@/data/users";
import { InvalidRequestError } from "@/lib/errors";
import { refuse } from "@/safety/refusals";
import { screenSceneIdea } from "@/safety/screen";
import { withModelSpend } from "@/spend";

import { startJob } from "./index";
import { ONBOARDING_FREEBIE, type JobView } from "./types";

/* The one free photo, start to finish, in one place.
 *
 * Two screens offer it — the last step of setup, and a card at the top of the
 * Library for accounts that were set up before it existed — and they must not
 * be able to disagree about who is allowed one. So the rules live here and the
 * actions are what they are supposed to be: validate, authorise, call this.
 *
 * The order of the four steps below is the design, and it is the part worth
 * reading twice:
 *
 *  1. The avatar has to be able to make a photo at all.
 *  2. A confirmed email address, because this is the only thing given away and
 *     an unconfirmed address is how one person becomes a hundred accounts.
 *  3. The scene idea is screened BEFORE the claim is spent, so a refusal she
 *     can reword costs her nothing.
 *  4. Only then is the freebie claimed — one conditional UPDATE, so of two
 *     taps exactly one gets it — and the job started. If starting throws, the
 *     claim goes back: a rate limit or a daily cap is something she can retry
 *     in an hour and must not cost her the gift.
 */

/** Something she can act on, with the freebie still hers. */
export class FreePhotoUnavailableError extends InvalidRequestError {}

export const UNVERIFIED_EMAIL_MESSAGE =
  "Your email address is not confirmed yet. Click the link in the email we sent, then reload this page — your free " +
  "photo will still be here. You can also skip it and take it later from your Library.";

export const ALREADY_USED_MESSAGE =
  "Your free photo has already been used. There is one per account, and everything from here is paid for with credits.";

export interface FreePhotoRequest {
  idea: string;
  requestId: string;
  /** Which avatar. Null falls back to the first, for a caller with nothing better. */
  avatarId?: string | null;
}

/**
 * Generate this account's one free photo, or refuse with a sentence.
 *
 * The job is an ordinary `image` job: screened, rate limited against the same
 * `jobs` allowance, counted against the global daily budget, idempotent on its
 * request id, and its real provider cost recorded in `provider_costs`. It
 * differs in exactly two ways — it is priced at zero and it does not ask for a
 * plan — and both of those are decided by the marker on its input.
 */
export async function startFreePhoto(user: User, request: FreePhotoRequest): Promise<JobView> {
  const avatar = (request.avatarId ? await getAvatar(user.id, request.avatarId) : null) ?? (await primaryAvatar(user.id));
  const lock = identityLock(avatar);
  if (!avatar || !lock) {
    throw new InvalidRequestError("She has no description yet. Finish her setup first, then come back for this.");
  }

  if (!(await hasVerifiedEmail(user.id))) throw new FreePhotoUnavailableError(UNVERIFIED_EMAIL_MESSAGE);

  const idea = request.idea.trim();
  if (idea.length < 8) throw new InvalidRequestError("Say where she is and what she is doing, in one line.");

  const verdict = await withModelSpend(user, { limit: "vision", shape: "screen_idea" }, () => screenSceneIdea(idea));
  if (!verdict.ok) await refuse(user.id, "scene_idea", verdict);

  const claimedAt = await claimFreePhoto(user.id);
  if (!claimedAt) throw new FreePhotoUnavailableError(ALREADY_USED_MESSAGE);

  try {
    return await startJob(user, {
      kind: "image",
      avatarId: avatar.id,
      requestId: request.requestId,
      input: {
        kind: "image",
        idea,
        shot: "selfie",
        freebie: ONBOARDING_FREEBIE,
        /* The claim travels with the job that spends it, so the poll that
           finds this job failed can hand back exactly this claim. */
        freebieClaimedAt: claimedAt.toISOString(),
        /* One paid take, not the usual two. A rejected take is normally
           reworded and redone, and on a photo she is paying for the second
           image is worth it; on one we are giving away it would mean a gift
           that can cost us twice. */
        maxTakes: 1,
      },
    });
  } catch (error) {
    /* Nothing was generated, so the gift was not delivered. Handing it back is
       conditional on the timestamp written above, so this cannot undo a claim
       that has since been released and taken again. */
    await releaseFreePhoto(user.id, claimedAt);
    throw error;
  }
}

/**
 * A scene she said she is photographed in, for the suggestion box.
 *
 * Her own words where there are any: the point of the first photo is that it
 * looks like the avatar she just described, not like our example.
 */
export function suggestedScene(scenes: readonly string[]): string {
  return scenes.find((scene) => scene.trim().length >= 8)?.trim() ?? "At a sunny kitchen table with a coffee, morning light";
}

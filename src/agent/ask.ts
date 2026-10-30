import { spendableBalance } from "@/billing/credits";
import { decidePaidAction } from "@/billing/gate";
import type { CreditStore } from "@/billing/store";
import { photoShelf } from "@/components/library/shelves";
import type { BrandProfile } from "@/content/hooks";
import { avatarOrPrimary, identityLock, type Avatar } from "@/data/avatars";
import { getProfile, profileComplete } from "@/data/brand";
import { isUuid } from "@/data/ids";
import { getMedia, type Media } from "@/data/media";
import type { User } from "@/data/users";
import { InvalidRequestError } from "@/lib/errors";

import { MAX_MATERIAL_PHOTOS, MAX_MESSAGE_CHARS, type AgentRequest, type Material } from "./plan";
import type { LastChat } from "./understand";

/* What every start from the chat shares: the avatar it runs on, the price
   check made before anything starts, and the attached library items looked
   up as hers. The run's children are the same photo, clip, reel and carousel
   jobs the buttons start, so nothing here needs its own price list:
   `affordable` asks the same question `startJob` will, only earlier and for
   the whole run.

   Nothing here reads a cookie. The caller says which avatar; one that is not
   hers, or none, is her first. */

/** A refusal that carries the way out: where to see the credits, in one tap. */
export class NeedsBillingError extends InvalidRequestError {
  readonly fix: { label: string; href: string };

  constructor(message: string, fix: { label: string; href: string }) {
    super(message);
    this.name = "InvalidRequestError";
    this.fix = fix;
  }
}

export type ReadyAvatar = { avatar: Avatar; profile: BrandProfile };

/** The avatar she asked for (else her first), with a finished Brand page and a finished setup, or a refusal in words. */
export async function readyAvatar(user: User, avatarId: string | null): Promise<ReadyAvatar> {
  const avatar = await avatarOrPrimary(user.id, avatarId);
  const profile = await getProfile(user.id, avatar?.id ?? null);
  if (!avatar || !profileComplete(profile)) throw new InvalidRequestError("Fill in the Brand page first: niche, audience, offer and keyword.");
  if (!identityLock(avatar)) throw new InvalidRequestError("Finish her setup first: the agent needs her description to make photos.");
  return { avatar, profile };
}

/** The same decision the buttons make, for the whole run at once. */
export async function affordable(user: User, cost: number, noun: string, credits?: CreditStore): Promise<void> {
  if (cost === 0) return;
  // The free grant lands first, so a new account's first paid request can spend it.
  const decision = decidePaidAction({ user, balance: await spendableBalance(user.id, credits), cost, noun });
  if (!decision.allowed) throw new NeedsBillingError(`${decision.headline}. ${decision.detail}`, decision.fix);
}

/* A request id is the idempotency key for money. The server actions' guard
   swaps anything that is not a UUID for a fresh one before it gets here; a
   caller without that guard is refused instead, because a key it cannot
   repeat would let one delivery charge twice. */
export function requireRequestId(requestId: string): void {
  if (typeof requestId !== "string" || !isUuid(requestId)) throw new InvalidRequestError("The request id must be a UUID. Make a new one for each new request.");
}

export const QUOTE_PHOTO_REFUSED = "One of the attached photos already has words on it, so new words would land on top of them. Pick a photo without words.";

/**
 * The attached library items, each looked up scoped to this user: a kept
 * photo or a clip of this avatar (or of none). An id that is not hers is
 * refused in words before anything is read or charged.
 */
export async function ownMaterial(
  userId: string,
  avatarId: string,
  material: Material | null,
  media: (userId: string, mediaId: string) => Promise<Media | null> = getMedia,
): Promise<{ material: Material | null; clip: Media | null; photos: Media[] }> {
  if (!material) return { material: null, clip: null, photos: [] };
  const mine = (row: Media | null) => row && (!row.avatarId || row.avatarId === avatarId) ? row : null;
  const photos: Media[] = [];
  for (const id of material.photos.slice(0, MAX_MATERIAL_PHOTOS)) {
    const row = mine(await media(userId, id));
    if (!row || row.kind !== "image" || (row.meta as { keep?: unknown }).keep === false) {
      throw new InvalidRequestError("One of the attached photos is not in your library. Take it off and attach it again.");
    }
    /* A quote photo already carries words: a set, a story, a clip or new
       words built on it draw text over text. Refused for every caller, the
       chat's + and Claude's use_media alike, before anything is charged. */
    if (photoShelf(row.meta) === "words") throw new InvalidRequestError(QUOTE_PHOTO_REFUSED);
    photos.push(row);
  }
  const clip = material.clip ? mine(await media(userId, material.clip)) : null;
  if (material.clip && (!clip || clip.kind !== "clip")) throw new InvalidRequestError("The attached clip is not in your library. Take it off and attach it again.");
  return { material, clip, photos };
}

/**
 * A reel on footage she attached is shaped by that footage: a clip with her
 * voice is a talking reel and one without is not, whatever the words said;
 * a photo gives the writer its scene, so the hook and the movement fit it.
 */
export function fitToFootage(request: AgentRequest, clip: Media | null, photos: Media[]): AgentRequest {
  if (request.kind !== "reel") return request;
  if (clip) return { ...request, talking: (clip.meta as { speech?: unknown }).speech === true, footage: "auto" };
  const idea = (photos[0]?.meta as { idea?: unknown } | undefined)?.idea;
  return typeof idea === "string" && idea.trim() && !request.scene ? { ...request, scene: idea.trim() } : request;
}

/** The chat exchange the client says came just before, as context only: two short strings, or nothing. */
export function lastChatFrom(value: unknown): LastChat | null {
  const raw = value as { message?: unknown; reply?: unknown } | null | undefined;
  if (!raw || typeof raw.message !== "string" || typeof raw.reply !== "string") return null;
  const message = raw.message.trim().slice(0, MAX_MESSAGE_CHARS);
  const reply = raw.reply.trim().slice(0, 1000);
  return message && reply ? { message, reply } : null;
}

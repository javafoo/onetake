/* What users pay, in credits. One credit buys one photo.

   The scale is a product decision, not an accounting one: a person should be
   able to read a number and know what it makes. A credit is priced at three
   times the list cost of the photo it buys, and the list cost (not a
   promotional rate) is the basis, so a vendor ending a promotion cannot push a
   price underwater. Rounding is up to the next whole credit and nothing else —
   a price that reads 3 and a price that reads 2.8 are the same money, and only
   one of them can be said out loud.

   Change prices here only; nothing else may hard-code a cost. */

/** Retail value of one credit. One Nano Banana Pro photo lists at $0.134. */
export const CREDIT_USD = 0.45;

/** Credits every new account is given once, on first use. There is no way to buy more. */
export const FREE_CREDITS = 60;

export type Action =
  | { kind: "image"; model: "pro" | "daily" }
  | { kind: "clip"; model: "omni"; seconds: number }
  | { kind: "identity_view" }
  | { kind: "reel" | "carousel" | "text" };

/* Gemini Omni Flash is token-metered: $17.50 per million video tokens at
   5,792 a second for 720p, so $0.1014, plus under a cent a clip for the prompt
   and the model's thinking. $0.104 covers both from three seconds up
   (`src/ai/omni.ts` has the measured clip). It always makes sound. */
const CLIP_USD_PER_SECOND = { omni: 0.104 } as const;

/** Provider list cost in USD. */
export function costUsd(action: Action): number {
  switch (action.kind) {
    /* Nano Banana 2.1 at the 2K size `src/ai/gemini.ts` asks for: $0.0504 listed,
       held at $0.06 because its input tokens cost three times Nano Banana 2's and
       a photo carries her reference photos. Pro is $0.134 at 2K. */
    case "image": return action.model === "pro" ? 0.134 : 0.06;
    case "identity_view": return 0.134;
    case "clip": return CLIP_USD_PER_SECOND[action.model] * action.seconds;
    default: return 0; // rendering and writing are free
  }
}

const MARKUP = 3;

/* Nano Banana Pro is the upgrade over the default photo model and is sold as
   one: by the formula alone both round to one credit, and at the same price
   everyone would pick the dearer model. A business floor, not a cost figure
   */
const PRO_PHOTO_CREDITS = 2;

/**
 * The price of one action, in whole credits.
 *
 * Rounded up, and up only: a fraction of a credit cannot be spent, and
 * rounding down would sell the difference. A Nano Banana 2 photo is 1, a Pro
 * photo 2, an identity view 1, a five-second Omni clip 4.
 */
export function creditsFor(action: Action): number {
  const cost = costUsd(action);
  const credits = cost === 0 ? 0 : Math.ceil((cost * MARKUP) / CREDIT_USD);
  if (action.kind === "image" && action.model === "pro") return Math.max(credits, PRO_PHOTO_CREDITS);
  return credits;
}

/* Whether a paid button may be pressed, and what to say when it may not.

   Pure: entitlements plus a balance plus a price in, one decision out. The
   page, the gate component and the tests all read the same answer, so what the
   button says before it is pressed and what the job says afterwards cannot
   drift apart. Prices come from `pricing.ts` and nowhere else. */

import { DEFAULT_IMAGE_MODEL } from "../content/image-options";

import type { EntitlementUser } from "./entitlements";
import { creditsFor } from "./pricing";

/** The two paid actions the product actually sells today, at their default models. */
export const PHOTO_CREDITS = creditsFor({ kind: "image", model: DEFAULT_IMAGE_MODEL });
export const CLIP_SECONDS = 5;
export const CLIP_CREDITS = creditsFor({ kind: "clip", model: "omni", seconds: CLIP_SECONDS });

/* "five-second clip", not "5-second clip": a length written as a word reads as
   a description, a numeral next to a price reads as another price. Anything
   other than the lengths we sell falls back to the numeral. */
const SECONDS_IN_WORDS: Record<number, string> = { 3: "three", 5: "five", 8: "eight", 10: "ten" };
export function clipNoun(seconds: number): string {
  return `${SECONDS_IN_WORDS[seconds] ?? seconds}-second clip`;
}
export const CLIP_NOUN = clipNoun(CLIP_SECONDS);

/** Credits, written the way they are read: 1,200 rather than 1200. */
export function formatCredits(credits: number): string {
  return Math.abs(credits).toLocaleString("en-US");
}

function plural(count: number, noun: string): string {
  return `${formatCredits(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** "3 credits", "1 credit". A photo costs one, so the s cannot be assumed. */
export function creditsWord(credits: number): string {
  return `${formatCredits(credits)} credit${Math.abs(credits) === 1 ? "" : "s"}`;
}

/* ------------------------------------------------------------------ */
/* What credits buy                                                    */
/* ------------------------------------------------------------------ */

export interface CreditsBuy {
  /** Whole photos this balance covers. */
  photos: number;
  /** Whole five-second clips this balance covers. */
  clips: number;
}

/** How many of each paid thing a balance covers. Never negative. */
export function whatCreditsBuy(credits: number): CreditsBuy {
  const spendable = Math.max(0, Math.floor(credits));
  return {
    photos: Math.floor(spendable / PHOTO_CREDITS),
    clips: Math.floor(spendable / CLIP_CREDITS),
  };
}

/** The same thing in a sentence, for the page under the balance. */
export function creditsBuySentence(credits: number): string {
  const { photos, clips } = whatCreditsBuy(credits);
  if (photos === 0) {
    return `Not enough for a photo (${creditsWord(PHOTO_CREDITS)}) or a ${CLIP_NOUN} (${creditsWord(CLIP_CREDITS)}).`;
  }
  if (clips === 0) {
    return `About ${plural(photos, "photo")}. A ${CLIP_NOUN} costs ${CLIP_CREDITS}.`;
  }
  return `About ${plural(photos, "photo")}, or ${plural(clips, CLIP_NOUN)}.`;
}

/* ------------------------------------------------------------------ */
/* The gate                                                            */
/* ------------------------------------------------------------------ */

/** Where the balance and what it was spent on are shown. */
export const CREDITS_PAGE = "/account#credits";

export type GateBlock = "low_credits";

export interface GateFix {
  label: string;
  href: string;
}

export type GateDecision =
  | {
      allowed: true;
      cost: number;
      balance: number;
      /** How many more times this action can be afforded, including this one. */
      runsLeft: number;
    }
  | {
      allowed: false;
      reason: GateBlock;
      /** A short heading: what is wrong. */
      headline: string;
      /** One or two plain sentences: why, and what it costs the user. */
      detail: string;
      /** Where to go and what the link says. */
      fix: GateFix;
      /** Credits still needed. Zero unless the reason is `low_credits`. */
      shortfall: number;
      cost: number;
      balance: number;
    };

/**
 * A caller's own last word before paid work starts, after the balance check
 * has passed: a daily cap, a price ceiling, a quote that stops here. It is
 * given the credits the work would take and what it is, in words. It refuses
 * by throwing, and when it runs nothing has been started or charged yet.
 */
export type PaidGate = (credits: number, noun: string) => Promise<void>;

export interface GateInput {
  /** The `users` row, or its id. */
  user: EntitlementUser;
  balance: number;
  /** Price of this action in credits, from `creditsFor`. */
  cost: number;
  /** What the button makes, in the user's words: "photo", "clip". */
  noun: string;
}

/**
 * Decide whether this person can press this paid button right now. Every
 * account may generate; the only thing that stops a paid action is a balance
 * that does not cover it.
 */
export function decidePaidAction({ balance, cost, noun }: GateInput): GateDecision {
  if (balance < cost) {
    const shortfall = cost - balance;
    return {
      allowed: false,
      reason: "low_credits",
      headline: "Not enough credits",
      detail: `A ${noun} costs ${creditsWord(cost)} and you have ${formatCredits(balance)} left. Every account has a fixed number of free credits.`,
      fix: { label: "See your credits", href: CREDITS_PAGE },
      shortfall,
      cost,
      balance,
    };
  }

  return { allowed: true, cost, balance, runsLeft: cost > 0 ? Math.floor(balance / cost) : Infinity };
}

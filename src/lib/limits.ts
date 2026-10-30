/* Every rate limit in the product, in one file.
 *
 * The reason this exists: `requireCanGenerate` and the daily budget check only
 * ever ran inside `startJob`, and most of what calls a model is not a job.
 * Writing hooks, the whole setup interview, topic suggestions, face finding,
 * the brief builder and carousel writing all called Gemini with nothing
 * counting the calls, so a free account could sit in a loop and run up the
 * bill. A limit is not a paywall — see the free allowances below — it is the
 * thing that makes the bill bounded.
 *
 * Everything here is pure: the numbers, the window arithmetic and the
 * sentences. `rate-limit.ts` is what talks to Postgres.
 */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export interface LimitRule {
  /** The column value in `rate_limits`. Changing it resets everyone's count. */
  bucket: string;
  /** What the person was doing, in their words, for the refusal sentence. */
  noun: string;
  /** Allowance for an account with no active plan. */
  free: number;
  /** Allowance with one. Equal to `free` where a plan buys no more of this. */
  withPlan: number;
  windowMs: number;
}

/**
 * The named limits.
 *
 * Hooks and carousels have a real free allowance on purpose: the product needs
 * a free taste before the paywall, and the paywall is credits, which photos and
 * clips still need. Everything else is sized so an honest run through setup or
 * a hard day's work never touches it.
 */
export const LIMITS = {
  /** writeHooksAction: two text calls each time. */
  hooks: { bucket: "hooks", noun: "sets of hooks", free: 20, withPlan: 100, windowMs: DAY },
  /** Every model call inside the setup interview: the coach, the voice samples, the lock. */
  onboarding: { bucket: "onboarding", noun: "setup steps", free: 150, withPlan: 150, windowMs: DAY },
  /** createCarouselAction: a writer pass plus face finding per set. */
  carousel: { bucket: "carousel", noun: "carousel sets", free: 30, withPlan: 30, windowMs: DAY },
  /**
   * Reel assembly: ffmpeg and one face look, no credits. Free with a plan, and
   * the number is high because one clip carries many hooks by design; the
   * free allowance is a taste, like hooks. Used to share the carousel bucket,
   * which is how a reel was once refused with "30 carousel sets today".
   */
  reels: { bucket: "reels", noun: "reels", free: 20, withPlan: 200, windowMs: DAY },
  /** rebuildBriefAction: one long text call over every source document. */
  brief: { bucket: "brief", noun: "brief rebuilds", free: 10, withPlan: 10, windowMs: DAY },
  /** The photo upload endpoint: a decode each time, whether or not a model follows. */
  upload: { bucket: "upload", noun: "photo uploads", free: 60, withPlan: 60, windowMs: HOUR },
  /** Vision calls outside setup: topic suggestions, face finding, screening. */
  vision: { bucket: "vision", noun: "photo checks", free: 120, withPlan: 300, windowMs: DAY },
  /**
   * The Animate drawer's free helpers: suggested movements and prompt polish.
   *
   * Both are short calls and both are free to the creator, which is exactly
   * why they need a number: tapping between photos asks for suggestions and
   * every submission asks for a polish. Sixty is far more than a working day
   * of animating (a clip costs three credits, so nobody makes sixty) and far
   * less than a loop. A photo is only ever looked at once, so most taps after
   * the first cost nothing at all.
   */
  motion: { bucket: "motion", noun: "movement suggestions", free: 60, withPlan: 60, windowMs: DAY },
  /**
   * The agent: one message is a read plus a run, and both count here, so the
   * numbers are twice the messages they allow. The children of a run (photos,
   * clips, reels, sets) are limited on their own.
   */
  agent: { bucket: "agent", noun: "agent requests", free: 40, withPlan: 300, windowMs: DAY },
  /** Agent v2 chat messages: one per turn, whatever tools it runs. Turns are free (A7), so they need a number. */
  chat: { bucket: "chat", noun: "messages", free: 20, withPlan: 150, windowMs: DAY },
  /** Words on one of her photos: a canvas and, once per photo, a face look. Free, so it needs a number. */
  textPhotos: { bucket: "text_photo", noun: "photos with words", free: 30, withPlan: 200, windowMs: DAY },
  /** Paid jobs. Credits already bound the spend; this bounds the concurrency. */
  jobs: { bucket: "jobs", noun: "generations", free: 40, withPlan: 300, windowMs: DAY },
} as const satisfies Record<string, LimitRule>;

export type LimitName = keyof typeof LIMITS;

/**
 * The short one, applied to every limited action on top of its own rule.
 *
 * A daily allowance alone still lets somebody spend all of it in four seconds,
 * which is the shape of an abuse run rather than of a person working. Thirty a
 * minute is far more than a person clicking, and far less than a script. It is
 * also set above every free daily allowance, so a person who runs out of one
 * of those hears about the one that actually ran out.
 */
export const BURST: LimitRule = { bucket: "burst", noun: "requests", free: 30, withPlan: 30, windowMs: MINUTE };

/** How many of `rule` this account gets. */
export function allowanceFor(rule: LimitRule, hasPlan: boolean): number {
  return hasPlan ? rule.withPlan : rule.free;
}

/* ------------------------------------------------------------------ */
/* Who may spend the free allowances at all                            */
/* ------------------------------------------------------------------ */

export const UNVERIFIED_EMAIL_MESSAGE =
  "Confirm your email address first: use the code or link we sent when you signed up, then try again.";

/**
 * The refusal for an account that may not spend the free allowances, or null.
 *
 * Free model calls are the cheap thing an account made seconds ago can drive
 * in a loop: the setup interview, screening uploads, writing hooks, the agent
 * reading a message. Every one of them is behind this. Sign-in, the Account
 * page and reading anything are not — those are how the person gets to the
 * confirmation step, and refusing them would lock her out of the fix.
 */
export function freeUseRefusal(emailVerified: boolean): string | null {
  return emailVerified ? null : UNVERIFIED_EMAIL_MESSAGE;
}

/* ------------------------------------------------------------------ */
/* Window arithmetic                                                   */
/* ------------------------------------------------------------------ */

/**
 * The start of the fixed window `at` falls in.
 *
 * Fixed windows, not a sliding log: one row per window per bucket, and a new
 * window is simply a new row, so nothing has to be pruned to stay correct and
 * the whole count is a single upsert. The cost is the usual one — somebody can
 * use the last of one window and the first of the next back to back — which is
 * what the burst rule is there to cover.
 */
export function windowStart(at: Date, windowMs: number): Date {
  return new Date(Math.floor(at.getTime() / windowMs) * windowMs);
}

/** When the window holding `at` ends, which is when the allowance comes back. */
export function windowEnd(at: Date, windowMs: number): Date {
  return new Date(windowStart(at, windowMs).getTime() + windowMs);
}

/** Milliseconds until the allowance comes back. Never negative. */
export function retryAfterMs(at: Date, windowMs: number): number {
  return Math.max(0, windowEnd(at, windowMs).getTime() - at.getTime());
}

/* ------------------------------------------------------------------ */
/* Saying so                                                           */
/* ------------------------------------------------------------------ */

/** "in about 40 seconds", "in about 3 minutes", "in about 2 hours". */
export function waitPhrase(ms: number): string {
  if (ms <= 0) return "now";
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 90) return `in about ${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) return `in about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `in about ${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * What a limited person reads.
 *
 * It says what ran out, how much of it they had, and when they can try again.
 * It does not apologise, accuse, or suggest that they have done something
 * wrong: most people who see this have a stuck button or an enthusiastic
 * afternoon, not bad intentions.
 */
export function limitMessage(rule: LimitRule, allowance: number, retryMs: number, hasPlan: boolean): string {
  const window = rule.windowMs >= DAY ? "today" : rule.windowMs >= HOUR ? "this hour" : "just now";
  const base = `That is ${allowance} ${rule.noun} ${window}, which is the limit. You can carry on ${waitPhrase(retryMs)}.`;
  /* Only where a plan actually raises the ceiling — offering an upgrade that
     changes nothing would be a lie told to sell something. */
  return !hasPlan && rule.withPlan > rule.free ? `${base} A plan raises this to ${rule.withPlan} a day.` : base;
}

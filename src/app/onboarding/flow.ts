import { STEP_IDS, type StepId } from "@/onboarding/steps";

/* Where the setup flow is up to, and where the browser is allowed to be.

   One screen per URL, so the back button and a link in an email both work. The
   position is never stored as a cursor that could drift from the data: it is
   derived from what actually exists (a session row, uploaded photos, reference
   photos, answered steps), so a half-finished setup reopens at the first thing
   that is still missing even if the last request died mid-write.

   Everything here is pure. `gateDecision` decides the redirect that keeps a
   half-set-up account inside setup; `resumeStage` decides where inside it. */

export const STAGES = ["welcome", "photos", "roles", ...STEP_IDS, "review", "first-photo"] as const;
export type Stage = (typeof STAGES)[number];

/** Photos wanted before the curation pass. Fewer than five and her face drifts. */
export const MIN_PHOTOS = 5;
export const MAX_PHOTOS = 15;

const INTERVIEW: readonly Stage[] = STEP_IDS;

export function stageIndex(stage: Stage): number {
  return STAGES.indexOf(stage);
}

export function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}

export function isInterviewStage(stage: Stage): stage is StepId {
  return INTERVIEW.includes(stage);
}

export function stagePath(stage: Stage): string {
  if (stage === "welcome") return "/onboarding/welcome";
  if (stage === "photos") return "/onboarding/photos";
  if (stage === "roles") return "/onboarding/photos/roles";
  if (stage === "review") return "/onboarding/review";
  if (stage === "first-photo") return "/onboarding/first-photo";
  return `/onboarding/interview/${stage}`;
}

/** The reverse of `stagePath`: which screen a URL is, or null for the ones that
    are not part of the run (the resume redirect, the paused screen). */
export function stageFromPath(pathname: string): Stage | null {
  const clean = pathname.replace(/\/+$/, "");
  return STAGES.find((stage) => stagePath(stage) === clean) ?? null;
}

export type FlowState = {
  /** An onboarding_sessions row exists, so she has named her and picked a kind. */
  hasSession: boolean;
  /** Photos of kind `upload` on this avatar. */
  uploads: number;
  /** avatar_references rows: the curated set. */
  references: number;
  /** The first unanswered interview step, or null when all seven are answered. */
  nextStep: StepId | null;
  /** True once the brief is saved: the review screen has been submitted. */
  reviewed?: boolean;
};

/**
 * The first thing that is still missing. This is where setup reopens.
 *
 * `first-photo` comes after the review screen has been submitted, and it is
 * the last thing in the run. It is deliberately not gated on whether she took
 * the photo: it is a free gift and a skip, not a step she can fail, so once
 * the brief is saved this is where a reopened setup lands and "Skip" is what
 * moves past it.
 */
export function resumeStage(flow: FlowState): Stage {
  if (!flow.hasSession) return "welcome";
  if (flow.uploads < MIN_PHOTOS) return "photos";
  if (flow.references === 0) return "roles";
  if (flow.nextStep) return flow.nextStep;
  return flow.reviewed ? "first-photo" : "review";
}

export function resumePath(flow: FlowState): string {
  return stagePath(resumeStage(flow));
}

/** Going back to change an answer is always allowed; skipping ahead is not. */
export function canVisit(target: Stage, flow: FlowState): boolean {
  return stageIndex(target) <= stageIndex(resumeStage(flow));
}

export type Progress = { step: number; total: number; ratio: number; label: string };

const LABEL: Record<string, string> = {
  welcome: "Name her",
  photos: "Her face",
  roles: "Her face",
  review: "Check it over",
  "first-photo": "Her first photo",
};

export function progressFor(stage: Stage, stepTitle?: string): Progress {
  const step = stageIndex(stage) + 1;
  return {
    step,
    total: STAGES.length,
    ratio: step / STAGES.length,
    label: LABEL[stage] ?? stepTitle ?? "Your brand",
  };
}

/* ---------------------------------------------------------------------------
   The gate.

   A signed-in account whose users.onboarded_at is null belongs in setup, and a
   finished one must never be sent back into it. Both directions are one
   function so the loop between them can be tested rather than discovered in a
   browser: the paths that let a person out of setup are the same paths that are
   exempt from being sent into it.
   ------------------------------------------------------------------------- */

/* Accounts that existed before there was a setup interview have everything it
   would have produced and a null onboarded_at, because the column was never
   written. Sending them into setup would be the worst possible first sight of
   this release, so having the pieces counts as having done it. */
export function alreadySetUp(input: { hasLock: boolean; references: number; brandComplete: boolean }): boolean {
  return input.hasLock && input.references > 0 && input.brandComplete;
}

/** A layout is given no pathname, so `src/proxy.ts` puts it in this request
    header and the root layout reads it back. */
export const PATHNAME_HEADER = "x-pathname";

/** Reachable without a finished setup: setup itself, the Account page, the API, and the auth screens. */
// /account stays reachable mid-setup: someone who uploaded photos and stopped must still be able to delete them.
const EXEMPT = ["/onboarding", "/account", "/api", "/sign-in", "/sign-up"];

export function isExempt(pathname: string): boolean {
  return EXEMPT.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/* A request the proxy never saw carries no pathname header. Deciding nothing in
   that case — what this used to do — means any path that slips past the proxy's
   matcher also slips past the gate, which is how a half-set-up account could
   reach an app page. An unknown path is therefore treated as "/": an ordinary
   app page, not exempt and not inside setup. That is the safe guess in both
   directions, and it cannot redirect a page to itself, because "/" is never a
   destination this function returns. */
export const UNKNOWN_PATHNAME = "/";

/**
 * The path to redirect to, or null to render what was asked for.
 *
 * `setupInProgress` is a finished account's second run through setup: adding
 * another avatar reuses the same screens, and while that session is open the
 * account may be inside them. It is never sent in — the rest of the app stays
 * hers throughout — only allowed to stay.
 */
export function gateDecision(input: { pathname: string; signedIn: boolean; onboarded: boolean; setupInProgress?: boolean }): string | null {
  // Signed out is the proxy's business, not ours.
  if (!input.signedIn) return null;

  const pathname = input.pathname.startsWith("/") ? input.pathname : UNKNOWN_PATHNAME;
  const inSetup = pathname === "/onboarding" || pathname.startsWith("/onboarding/");
  if (input.onboarded) return inSetup && !input.setupInProgress ? "/" : null;
  return isExempt(pathname) ? null : "/onboarding";
}

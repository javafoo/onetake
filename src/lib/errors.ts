import { randomBytes } from "node:crypto";

/* What a person is allowed to read when something goes wrong.
 *
 * Two kinds of failure reach a server action. The first is a refusal we wrote
 * on purpose — "Pick a photo from your library", "Not enough credits", "You
 * have written twenty sets of hooks today" — and its message is the whole
 * point of it. The second is anything else: a driver error, a null nobody
 * expected, a provider saying something in its own words. Those messages are
 * written for us, not for her, and passing them straight through is how an
 * internal path, a column name or a provider's phrasing ends up on screen.
 *
 * So: a known, user-facing class passes its message through untouched.
 * Everything else is logged on the server against a short reference and the
 * person is told that, plus the reference, so a support conversation can find
 * the one log line that matters.
 */

/** Base class for every error whose message was written for the person reading it. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

/** A request that cannot be honoured: a missing field, a bad id, a wrong state. */
export class InvalidRequestError extends UserFacingError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRequestError";
  }
}

/* Classes defined elsewhere whose messages are written for users. They are
   matched by name rather than by `instanceof` because several of them live in
   modules this one must not import (billing imports errors, not the other way
   round), and because a class can be duplicated across bundles. */
const USER_FACING_NAMES: ReadonlySet<string> = new Set([
  "UserFacingError",
  "InvalidRequestError",
  // src/billing
  "NotEntitledError",
  "InsufficientCreditsError",
  "NotEnoughCreditsError",
  "BillingRequestError",
  // src/jobs
  "BudgetExceededError",
  "UnsupportedJobError",
  // src/lib/rate-limit, src/lib/email-gate, src/safety, src/lib/image-bytes
  "RateLimitedError",
  "EmailNotVerifiedError",
  "SafetyRefusalError",
  "UploadRejectedError",
  // src/ai/provider-error: a provider out of credit, over quota or down
  "ProviderUnavailableError",
]);

/** True when this error's own message may be shown to the person who caused it. */
export function isUserFacing(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  if (error instanceof UserFacingError) return true;
  return USER_FACING_NAMES.has(error.name);
}

/** Six characters, unambiguous to read aloud, unique enough to find in a log. */
export function referenceId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1
  const bytes = randomBytes(6);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

/** What the person sees when we have nothing safe to tell them. */
export function opaqueMessage(reference: string): string {
  return `Something went wrong on our side (ref ${reference}). Nothing was charged. Try again in a moment.`;
}

const MAX_LOGGED = 600;

/* Nothing that could be a credential ever reaches a log line. Provider errors
   quote request URLs and headers often enough that this is not theoretical,
   and a base64 blob in a log is either a key or the first kilobyte of somebody's
   photograph — neither belongs there. */
const SECRET_SHAPES: [RegExp, string][] = [
  [/\b(?:sk|pk|rk|whsec|pi|cus|sub|evt)_[A-Za-z0-9_-]{8,}/g, "[redacted]"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]"],
  [/\b(?:api[-_]?key|key|token|secret|password|authorization)["'\s:=]+[A-Za-z0-9._~+/-]{8,}/gi, "[redacted]"],
  [/\bAIza[A-Za-z0-9_-]{10,}/g, "[redacted]"],
  [/[A-Za-z0-9+/]{120,}={0,2}/g, "[redacted base64]"],
];

export function scrub(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_SHAPES) out = out.replace(pattern, replacement);
  return out.length > MAX_LOGGED ? `${out.slice(0, MAX_LOGGED)}…` : out;
}

/**
 * Log an unexpected failure against a fresh reference and return the reference.
 *
 * `where` is the action or route, so the log line says which one without the
 * caller having to repeat itself in the message.
 */
export function logUnexpected(where: string, error: unknown): string {
  const reference = referenceId();
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error && error.stack ? scrub(error.stack.split("\n").slice(0, 6).join("\n")) : "";
  console.error(`[${reference}] ${where}: ${name}: ${scrub(message)}${stack ? `\n${stack}` : ""}`);
  return reference;
}

/**
 * The sentence to show for a failure: the error's own message when it was
 * written for a person, otherwise a reference to the line in our log.
 */
export function userMessage(where: string, error: unknown): string {
  if (isUserFacing(error)) return error.message;
  return opaqueMessage(logUnexpected(where, error));
}

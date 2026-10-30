import { InvalidRequestError } from "@/lib/errors";

/* Starting paid work once per thing, not once per request id.

   A request id makes one delivery of one press safe to repeat. It does not
   stop two different presses on the same thing: two tabs pressing Make it on
   one plan, or Claude and her phone both retrying one failed run. Each has
   its own request id, so each would start (and pay for) its own run.

   So the thing being started from carries a claim: a conditional write on
   its own row, stamped with the request id that won, made after the price
   was agreed and before anything is started or charged. The conditional
   write (on `updated_at`) means only one caller can make it. Whoever loses
   reads the row again and is handed the winner's work instead of starting
   its own. A claim whose request id never became a job (the start failed and
   the claim could not be taken back, or the process died in between) is
   stale after a couple of minutes, and the next caller may take it over.

   Pure: the rows are read and written by the callers. */

/** Written on the row a start begins from: which request is starting it, and since when. */
export type StartClaim = { requestId: string; at: string };

/** Long past any start: a claim this old whose request never became a job was left by a start that died. */
export const CLAIM_STALE_MS = 2 * 60_000;

export function newClaim(requestId: string, now: Date): StartClaim {
  return { requestId, at: now.toISOString() };
}

/** A stopped run's input without its claim: what a continuation copies, so a new run never starts out claimed. */
export function withoutRetry<T extends { retry?: StartClaim }>(input: T): T {
  const copy = { ...input };
  delete copy.retry;
  return copy;
}

/** True while a claim may still turn into a job, so another start must wait for it. */
export function claimLive(claim: StartClaim | undefined | null, now: Date): claim is StartClaim {
  if (!claim || typeof claim.requestId !== "string" || typeof claim.at !== "string") return false;
  const at = Date.parse(claim.at);
  return Number.isFinite(at) && now.getTime() - at < CLAIM_STALE_MS;
}

/**
 * How long a press that finds a live claim waits for the claimed run to
 * exist. The press that holds the claim is between its claim and its start,
 * which takes seconds (the plan's screen, a few writes); waiting that long
 * means the second press is handed the run rather than told to try again.
 */
export const WAIT_FOR_CLAIM_MS = 8_000;
const WAIT_STEP_MS = 150;

/**
 * Read with `read` until `starting` says the answer is no longer "being
 * started", or the wait is over; the last answer is returned either way.
 */
export async function whileStarting<T>(read: () => Promise<T>, starting: (value: T) => boolean, budgetMs = WAIT_FOR_CLAIM_MS): Promise<T> {
  let value = await read();
  for (let waited = 0; starting(value) && waited < budgetMs; waited += WAIT_STEP_MS) {
    await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
    value = await read();
  }
  return value;
}

/** Said when a request id comes back attached to something other than what it first started. */
export const REQUEST_ID_REUSED = "That request_id was already used for something else. Make a new one.";

/**
 * A request id that already started something else. Refused before anything
 * is read by a model, priced, counted or written: a repeat must be the same
 * thing, or it is not a repeat.
 */
export class RequestIdReusedError extends InvalidRequestError {
  constructor() {
    super(REQUEST_ID_REUSED);
    this.name = "InvalidRequestError";
  }
}

/** Another press is starting the same thing this very moment. */
export class BeingStartedError extends InvalidRequestError {
  constructor(message = "This is being started right now. Look again in a moment.") {
    super(message);
    this.name = "InvalidRequestError";
  }
}

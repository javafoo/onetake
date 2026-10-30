import { InvalidRequestError } from "@/lib/errors";

import { claimLive, type StartClaim } from "./claim";
import { findJobByRequest, type JobDeps } from "./index";
import type { JobRecord } from "./types";

/* Where a stopped run went next.

   "Try again from here" and "Redo this scene" start a new run from a failed
   one, and the failed one keeps a claim naming the request that did it
   (src/jobs/claim.ts). That new run may itself stop and be continued, and so
   on. Pressing the button again on the first run must not buy what the
   second is already making: it is handed the newest run of the chain, or,
   when that one stopped too, told to continue that one instead. */

/** How many continuations are followed. A chain this long is somebody pressing on purpose; the newest reached is answered. */
const MAX_HOPS = 20;

export type Continuation =
  /** Nobody has continued this run. */
  | { kind: "none" }
  /** A continuation is being started right now, by another press. */
  | { kind: "starting" }
  /** The newest run of the chain, still going or finished. */
  | { kind: "found"; record: JobRecord }
  /** The newest run of the chain stopped too: that is the one to continue. */
  | { kind: "stopped"; record: JobRecord };

type Continuable = JobRecord & { input: { resumedFrom?: string; retry?: StartClaim } };

/**
 * Follow a stopped run's claims to the newest run. `isContinuation(next,
 * previous)` says a job really is the run that continues `previous` (right
 * kind, `resumedFrom` pointing back); a claim whose request became something
 * else, or nothing, and has gone stale, ends the chain where it is.
 */
export async function continuationOf(
  userId: string,
  run: Continuable,
  isContinuation: (next: JobRecord, previous: JobRecord) => next is Continuable,
  jobs: Partial<JobDeps>,
  now: Date,
): Promise<Continuation> {
  let current: Continuable = run;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const claim = current.input.retry;
    const next = claim && typeof claim.requestId === "string" ? await findJobByRequest(userId, claim.requestId, jobs) : null;
    if (next && isContinuation(next, current)) {
      current = next;
      continue;
    }
    if (!next && claimLive(claim, now)) return { kind: "starting" };
    break;
  }
  if (current === run) return { kind: "none" };
  return current.status === "failed" ? { kind: "stopped", record: current } : { kind: "found", record: current };
}

/**
 * The run pressed on was continued already, and that continuation stopped
 * too. Carries the newest run's id, so a caller with no screen (Claude) can
 * say which one to continue.
 */
export class AlreadyContinuedError extends InvalidRequestError {
  constructor(
    message: string,
    readonly latestId: string,
  ) {
    super(message);
    this.name = "InvalidRequestError";
  }
}

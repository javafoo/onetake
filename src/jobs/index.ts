import { liveAgentDeps } from "@/agent/live";
import { liveWeekDeps } from "@/week/live";
import type { WeekDeps } from "@/week/step";
import type { AgentDeps, ChildJobs } from "@/agent/step";
import { InsufficientCreditsError, refund, reserve } from "@/billing/credits";
import { jobModelEstimateUsd } from "@/ai/estimates";
import { CLIP_ENDPOINT, clipProviderOf } from "@/ai/clips";
import { InvalidRequestError } from "@/lib/errors";
import { requireWithinLimit, type LimitedUser } from "@/lib/rate-limit";
import type { LimitName } from "@/lib/limits";
import { requireCanGenerate, type EntitlementUser } from "@/billing/entitlements";
import { creditsFor, costUsd } from "@/billing/pricing";
import type { CreditStore, UserBillingRow } from "@/billing/store";
import { dbCreditStore, dbUserStore } from "@/billing/store.db";
import { MAX_TAKES } from "@/content/scene";

import { BudgetExceededError, globalDailyBudgetUsd } from "./budget";
import { liveProviders } from "./providers.live";
import type { JobProviders } from "./providers";
import { plainMessage, POLL_DRIVEN, runStep } from "./runner";
import { afterResponse, type Scheduler } from "./schedule";
import type { JobStore } from "./store";
import { dbJobStore } from "./store.db";
import { clipModelOf, isFreebie, pricingAction, type JobInput, type JobKind, type JobRecord, type JobView } from "./types";

/* The job lifecycle.
 *
 * Anything slow or paid is a job. `startJob` prices it, records it, reserves
 * the credits and returns; `advanceJob` moves it along and is safe to call from
 * two polls at once. The invariants, in order of how much they would cost us to
 * get wrong:
 *
 * 1. A repeated `requestId` never charges twice. The unique index on
 *    (user_id, request_id) decides that, not this code.
 * 2. Credits are reserved before any provider is called and refunded if
 *    anything fails. A job that could not be paid for leaves no row behind.
 * 3. Two polls cannot both store an output. Every step is taken under a
 *    conditional update, and the finishing write refuses if an output exists.
 * 4. Everything we spend lands in `provider_costs`: reserved before the call,
 *    then done or refunded. The global daily cap is read from that table.
 */

export { BudgetExceededError, globalDailyBudgetUsd } from "./budget";
export { InsufficientCreditsError } from "@/billing/credits";
export type { JobInput, JobKind, JobRecord, JobStatus, JobView } from "./types";

/** A job stuck with nothing to poll for this long is written off on the next look. */
export const STUCK_AFTER_MS = 10 * 60 * 1000;

/** The `users` row, or as much of it as jobs need. */
export type JobUser = EntitlementUser & { id: string };

export interface JobDeps {
  store: JobStore;
  credits: CreditStore;
  providers: JobProviders;
  schedule: Scheduler;
  now: () => Date;
  budgetUsd: () => number;
  /** Takes one from this user's allowance, or throws `RateLimitedError`. */
  limits: (user: LimitedUser, name: LimitName) => Promise<void>;
  /** The billing columns of a user, so an agent run can start child jobs on its owner's behalf. */
  users: { find(userId: string): Promise<UserBillingRow | null> };
  /** The agent's model calls and reads. */
  agent: AgentDeps;
  /** The week's model calls, search and reads. */
  week: WeekDeps;
}

function withDefaults(deps: Partial<JobDeps> = {}): JobDeps {
  return {
    store: deps.store ?? dbJobStore,
    credits: deps.credits ?? dbCreditStore,
    providers: deps.providers ?? liveProviders,
    schedule: deps.schedule ?? afterResponse,
    now: deps.now ?? (() => new Date()),
    budgetUsd: deps.budgetUsd ?? globalDailyBudgetUsd,
    limits: deps.limits ?? ((user, name) => requireWithinLimit(user, name)),
    users: deps.users ?? dbUserStore,
    agent: deps.agent ?? liveAgentDeps,
    week: deps.week ?? liveWeekDeps,
  };
}

/** Insufficient credits, said the way a person should read it. */
export class NotEnoughCreditsError extends InsufficientCreditsError {
  constructor(balance: number, required: number) {
    super(balance, required);
    this.name = "NotEnoughCreditsError";
    this.message =
      `This costs ${required} credit${required === 1 ? "" : "s"} and you have ${balance} left. ` +
      `Nothing was charged.`;
  }
}

export class UnsupportedJobError extends Error {
  constructor(kind: string) {
    super(`There is no ${kind} job.`);
    this.name = "UnsupportedJobError";
  }
}

/* The kinds, as a runtime set. TypeScript has this as a closed union, but
   a job is started from a server action, which is a public endpoint: a kind
   that is not one of these has to be refused before anything is priced. */
const KINDS: ReadonlySet<string> = new Set<JobKind>(["image", "clip", "reel", "carousel", "agent", "text_photo", "week"]);

/**
 * What we expect a job to cost us, before it runs.
 *
 * A scene may take two paid images (a rejected take is reworded and redone),
 * so the worst case is reserved against the cap and the real figure replaces
 * it when the job settles. Under-reserving is what lets a cap be walked past.
 */
export function reservedCostUsd(input: JobInput): number {
  const base = costUsd(pricingAction(input));
  const output = input.kind === "image" ? base * (input.maxTakes ?? MAX_TAKES) : base;
  /* Plus the model calls the job makes around its output: the writer and the
     face finder for a carousel, the face finder for a reel, the prompt writer
     and the judge for a photo. `costUsd` is zero for a carousel and a reel
     because those are free to the user — which is what the *user* pays, not
     what *we* pay. */
  return output + jobModelEstimateUsd(input.kind);
}

/** Which allowance a job takes from. */
function limitFor(kind: JobKind, generation: boolean): LimitName {
  if (generation) return "jobs";
  if (kind === "reel") return "reels";
  if (kind === "agent" || kind === "week") return "agent";
  if (kind === "text_photo") return "textPhotos";
  return "carousel";
}

/* What goes in the `provider` and `model` columns of `provider_costs`, so a
   margin report can tell the kinds apart without reading the job's input blob. */
function providerOf(input: JobInput): { provider: string; model: string } {
  if (input.kind === "clip") return { provider: clipProviderOf(clipModelOf(input)), model: CLIP_ENDPOINT[clipModelOf(input)] };
  if (input.kind === "image") return { provider: "gemini", model: "image" };
  if (input.kind === "carousel" || input.kind === "text_photo") return { provider: "self", model: "canvas" };
  if (input.kind === "agent") return { provider: "self", model: "agent" };
  if (input.kind === "week") return { provider: "self", model: "week" };
  return { provider: "self", model: "ffmpeg" };
}

export interface StartJobRequest {
  kind: JobKind;
  input: JobInput;
  /** Generated by the browser before the submission leaves it. The idempotency key. */
  requestId: string;
  avatarId?: string | null;
}

/**
 * Price the action, record the job, hold the credits, and get the work moving.
 *
 * Returns quickly in every case: the work itself happens after the response
 * (`image`, `reel`) or at the provider (`clip`). Throws `NotEnoughCreditsError`
 * or `BudgetExceededError` — both carry a message that can be shown as it is.
 */
export async function startJob(user: JobUser, request: StartJobRequest, options: Partial<JobDeps> = {}): Promise<JobView> {
  return (await startJobOnce(user, request, options)).view;
}

/** What `startJobOnce` did: the job, and whether this call is the one that recorded it. */
export type StartedJob = { view: JobView; created: boolean };

/**
 * `startJob`, also saying whether this call recorded the job (and so reserved
 * for it) or found one a delivery of the same request id already had. A
 * caller that counted something of its own before the start gives it back
 * when this is false.
 */
export async function startJobOnce(user: JobUser, request: StartJobRequest, options: Partial<JobDeps> = {}): Promise<StartedJob> {
  const deps = withDefaults(options);

  if (!KINDS.has(request.kind)) throw new UnsupportedJobError(request.kind);
  if (request.kind !== request.input.kind) throw new Error("The job kind and its input disagree.");
  if (!request.requestId) throw new InvalidRequestError("This form is out of date. Reload the page and try again.");

  /* The one free photo is priced at zero. It is still a job in every other
     respect: screened, rate limited, counted against the global daily cap,
     idempotent on its requestId, and its real provider cost still lands in
     `provider_costs`. The only thing it does not do is take credits.

     Whether this account actually still has its freebie is not decided here —
     it is claimed off the `users` row before `startJob` is called, atomically,
     so two taps cannot both arrive holding one (`src/data/freebie.ts`). */
  const free = isFreebie(request.input);
  const credits = free ? 0 : creditsFor(pricingAction(request.input));

  if (credits > 0) requireCanGenerate(user);

  /* Every job is rate limited. Credits bound what an account can spend; this
     bounds what any account can start, which is the thing credits do not
     cover for the free kinds.

     The bucket follows what the work is, not what it costs: a paid photo or
     clip and the one free photo are generations; a reel, a set and an agent
     run are each their own free kind with their own allowance and their own
     name in the refusal. They used to share the carousel bucket, and a reel
     was refused with "30 carousel sets today". */
  await deps.limits(user, limitFor(request.kind, credits > 0 || free));

  // A retried submission gets the first job back, and pays nothing for it.
  const earlier = await deps.store.findByRequest(user.id, request.requestId);
  if (earlier) return { view: await view(earlier, deps), created: false };

  const estimate = reservedCostUsd(request.input);

  const { job, created } = await deps.store.create({
    userId: user.id,
    avatarId: request.avatarId ?? null,
    kind: request.kind,
    requestId: request.requestId,
    input: request.input,
    credits,
  });
  // Two deliveries raced and the other one won: it is charging, we are not.
  if (!created) return { view: await view(job, deps), created: false };

  /* The cap is ours, not the user's, and it applies to every job.
   *
   * This used to be guarded on `estimate > 0`, and `creditsFor` is zero for a
   * carousel and a reel — so the two kinds that call a model without charging
   * the user for it were invisible both to the cap and to `provider_costs`.
   * `reservedCostUsd` now floors every kind at what its model calls cost us,
   * and the check and the row are one atomic step, so concurrent starts cannot
   * all read the same total and all find room.
   *
   * It goes before the credit reservation so a blocked attempt leaves no
   * ledger rows at all, not even a reserve and its refund. */
  const cap = deps.budgetUsd();
  const { provider, model } = providerOf(request.input);
  const held = await deps.store.reserveCost(
    {
      userId: user.id,
      jobId: job.id,
      provider,
      model,
      kind: request.kind,
      costUsd: estimate,
      // The user id is repeated in meta so the row still names its owner after ON DELETE SET NULL.
      meta: { estimate: true, requestId: request.requestId, testUser: user.id.startsWith("test_") ? user.id : undefined },
    },
    cap,
  );
  if (!held.ok) {
    await deps.store.remove(user.id, job.id);
    throw new BudgetExceededError(held.spentUsd, cap, estimate);
  }

  try {
    await reserve(user.id, credits, job.id, deps.credits);
  } catch (error) {
    /* Nothing ran, so nothing should be left to look at. The refund comes
       before the row goes: a reservation can commit and its call still throw
       (the connection dropped on the way back), and deleting the job first
       would set the ledger row's job_id to null, so nothing could ever refund
       it. `refund` writes nothing when nothing was reserved. */
    await refund(job.id, deps.credits);
    await deps.store.settleCost({ jobId: job.id, status: "refunded", meta: { unpaid: true } });
    await deps.store.remove(user.id, job.id);
    if (error instanceof InsufficientCreditsError) throw new NotEnoughCreditsError(error.balance, error.required);
    throw error;
  }

  /* The work starts after the response. A clip's submission goes the same way,
     so the action returns in milliseconds; if that never runs, the first poll
     submits it instead, and until one of them does the job costs nothing but a
     row. */
  deps.schedule(() => runJob(user.id, job.id, options).then(() => undefined));

  return { view: await view(job, deps), created: true };
}

/**
 * Move a job forward and say where it got to. Safe to call from two polls at
 * once: whoever loses the claim reports the state instead of duplicating work.
 * Null means there is no such job for this user.
 */
export async function advanceJob(userId: string, jobId: string, options: Partial<JobDeps> = {}): Promise<JobView | null> {
  const deps = withDefaults(options);
  const job = await deps.store.find(userId, jobId);
  if (!job) return null;
  return step(job, deps, POLL_DRIVEN.has(job.kind), options);
}

/** The job a browser submission already started, if it did. */
export async function findJobByRequest(userId: string, requestId: string, options: Partial<JobDeps> = {}): Promise<JobRecord | null> {
  return withDefaults(options).store.findByRequest(userId, requestId);
}

/**
 * Replace the stored input of a finished job of this kind, scoped to its
 * owner. For a planning turn she edited on its card, or marked as made: the
 * turn itself is over, only what it holds changes. Null when there is no such
 * finished job, or when it changed underneath (the caller reads it again).
 */
export async function rewriteFinishedInput(userId: string, record: JobRecord, input: JobInput, options: Partial<JobDeps> = {}): Promise<JobRecord | null> {
  if (record.status !== "completed" || record.kind !== input.kind) return null;
  return withDefaults(options).store.transition({ userId, jobId: record.id, from: ["completed"], expectedUpdatedAt: record.updatedAt, patch: { input } });
}

/**
 * Replace the stored input of a job that has stopped (finished or failed),
 * scoped to its owner, only if the row is exactly as `record` read it. How a
 * start claims the row it begins from (src/jobs/claim.ts): of two callers
 * that read the same row, only one write lands. Null when it changed.
 */
export async function rewriteStoppedInput(userId: string, record: JobRecord, input: JobInput, options: Partial<JobDeps> = {}): Promise<JobRecord | null> {
  if ((record.status !== "completed" && record.status !== "failed") || record.kind !== input.kind) return null;
  return withDefaults(options).store.transition({ userId, jobId: record.id, from: [record.status], expectedUpdatedAt: record.updatedAt, patch: { input } });
}

/** Read a job without touching it. */
export async function getJob(userId: string, jobId: string, options: Partial<JobDeps> = {}): Promise<JobView | null> {
  const deps = withDefaults(options);
  const job = await deps.store.find(userId, jobId);
  return job ? view(job, deps) : null;
}

/**
 * The whole row, including its stored input. Scoped to the user like everything
 * else. `getJob` returns the view a client may see; this is for the server
 * paths that need to know what the job was asked to do — the poll route reads
 * the freebie claim off it.
 */
export async function getJobRecord(userId: string, jobId: string, options: Partial<JobDeps> = {}): Promise<JobRecord | null> {
  return withDefaults(options).store.find(userId, jobId);
}

/**
 * Run a job to wherever it can get in one invocation. This is what `after()`
 * calls; for `image` and `reel` that is the whole job.
 */
export async function runJob(userId: string, jobId: string, options: Partial<JobDeps> = {}): Promise<JobView | null> {
  const deps = withDefaults(options);
  const job = await deps.store.find(userId, jobId);
  if (!job) return null;
  return step(job, deps, true, options);
}

/**
 * How an agent run reaches the job machine it is running inside of. Bound to
 * the run's owner, so a child can only ever be started or polled as the same
 * account; the deps travel with it so a test's fakes reach the children too.
 */
function childrenFor(job: JobRecord, deps: JobDeps, options: Partial<JobDeps>): ChildJobs {
  return {
    async start(request) {
      const row = await deps.users.find(job.userId);
      if (!row) throw new Error("The account behind this run is gone.");
      return startJob({ id: row.id }, request, options);
    },
    advance: (jobId) => advanceJob(job.userId, jobId, options),
    stop: (jobId, message) => stopJob(job.userId, jobId, message, options),
  };
}

/**
 * Give up on a job that is still queued or running: fail it and refund it.
 * For the agent's deadline, which must not leave a child holding credits it
 * will never poll again. A job already settled is returned as it is.
 */
export async function stopJob(userId: string, jobId: string, message: string, options: Partial<JobDeps> = {}): Promise<JobView | null> {
  const deps = withDefaults(options);
  const job = await deps.store.find(userId, jobId);
  if (!job) return null;
  if (job.status === "completed" || job.status === "failed") return view(job, deps);
  return fail(job, message, deps);
}

async function step(job: JobRecord, deps: JobDeps, allowWork: boolean, options: Partial<JobDeps> = {}): Promise<JobView> {
  if (job.status === "completed" || job.status === "failed") return view(job, deps);

  /* Nothing to poll and nothing has moved for ten minutes: the invocation that
     was doing the work is gone (a crash, a timeout, a deploy). Write it off and
     give the credits back rather than leaving it spinning forever. */
  if (!job.providerRequestId && deps.now().getTime() - job.updatedAt.getTime() > STUCK_AFTER_MS) {
    return fail(job, "This took too long and was stopped before it finished.", deps);
  }

  if (!allowWork) return view(job, deps);

  /* The claim. Of two callers holding the same row only one update matches, so
     only one calls the provider and only one can store an output. */
  const claimed = await deps.store.transition({
    userId: job.userId,
    jobId: job.id,
    from: [job.status],
    expectedUpdatedAt: job.updatedAt,
    patch: { status: "running" },
  });
  if (!claimed) return view((await deps.store.find(job.userId, job.id)) ?? job, deps);

  let result;
  try {
    result = await runStep(claimed, { ...deps, children: childrenFor(claimed, deps, options), agent: deps.agent, week: deps.week });
  } catch (error) {
    return fail(claimed, plainMessage(error), deps);
  }

  if (!result.done) return view((await deps.store.find(job.userId, job.id)) ?? claimed, deps);
  if ("failed" in result) return fail(claimed, result.message, deps);

  const { outcome } = result;
  const finished = await deps.store.transition({
    userId: claimed.userId,
    jobId: claimed.id,
    from: ["running"],
    requireNoOutput: true,
    patch: {
      status: "completed",
      error: null,
      output: { mediaIds: outcome.mediaIds, message: outcome.message, meta: outcome.meta },
    },
  });

  if (!finished) {
    /* Somebody else finished this job while we were working. Their output is
       the one on the row, so ours is bytes nobody will ever reach. */
    await deps.providers.discardMedia(claimed.userId, outcome.mediaIds);
    return view((await deps.store.find(claimed.userId, claimed.id)) ?? claimed, deps);
  }

  await deps.store.settleCost({
    jobId: claimed.id,
    status: "done",
    costUsd: outcome.costUsd,
    meta: { estimate: false, ...(outcome.meta ?? {}) },
  });
  return view(finished, deps);
}

/**
 * Mark failed, give the credits back, and settle what the call cost us: nothing
 * when no provider was ever asked, the estimate when one was. A clip the
 * provider had accepted is billed whether or not we collect it — a deadline
 * or a lost request is our loss, not theirs — so writing that row off as
 * `refunded` made the daily cap under-count exactly the calls that were
 * wasted.
 *
 * The refund is conditional on the transition, and that is the whole point.
 * `from: ["queued", "running"]` matches nothing once another worker has written
 * the job as `completed`, and a completed job has an output the user keeps.
 * `refundJob` is idempotent against itself but knows nothing about
 * `jobs.status`, so refunding after a lost race would give back the credits for
 * work that was delivered. Only the caller that actually moved the row to
 * `failed` may undo its money.
 */
async function fail(job: JobRecord, message: string, deps: JobDeps): Promise<JobView> {
  const failed = await deps.store.transition({
    userId: job.userId,
    jobId: job.id,
    from: ["queued", "running"],
    patch: { status: "failed", error: message },
  });
  if (!failed) {
    // Somebody else settled this job while we were deciding to fail it. Their
    // verdict is the one on the row, so ours must not touch the ledger.
    return view((await deps.store.find(job.userId, job.id)) ?? job, deps);
  }
  await refund(job.id, deps.credits);
  const providerBilled = Boolean(failed.providerRequestId);
  await deps.store.settleCost({ jobId: job.id, status: providerBilled ? "done" : "refunded", meta: { error: message, ...(providerBilled ? { providerBilled: true } : {}) } });
  return view(failed, deps);
}

async function view(job: JobRecord, deps: JobDeps): Promise<JobView> {
  const { reserved, refunded } = await deps.store.credits(job.id);
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    error: job.error,
    mediaIds: job.output?.mediaIds ?? [],
    message: job.output?.message ?? null,
    credits: job.credits,
    creditsCharged: reserved - refunded,
    creditsRefunded: refunded,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

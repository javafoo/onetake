import type { JobKind, JobOutput, JobRecord, JobStatus, StoredJobInput } from "./types";

/* The narrow database surface the job machine needs: the `jobs` table and the
   `provider_costs` table. Everything in `src/jobs` talks to this, never to
   Drizzle directly, so the whole state machine can be tested against an
   in-memory fake with no Postgres and no network.

   `store.db.ts` is the Postgres implementation, `store.memory.ts` the fake. */

export interface CreateJobInput {
  userId: string;
  avatarId: string | null;
  kind: JobKind;
  requestId: string;
  input: StoredJobInput;
  credits: number;
}

export interface CreateJobResult {
  job: JobRecord;
  /** False when `(user_id, request_id)` already existed: the caller must not charge again. */
  created: boolean;
}

export interface JobPatch {
  status?: JobStatus;
  provider?: string | null;
  providerRequestId?: string | null;
  input?: StoredJobInput;
  output?: JobOutput | null;
  error?: string | null;
  credits?: number;
  avatarId?: string | null;
}

export interface TransitionInput {
  userId: string;
  jobId: string;
  /** The transition only applies if the row is in one of these states. */
  from: readonly JobStatus[];
  /**
   * The claim. The row must still carry this `updated_at` for the update to
   * land, so of two polls that read the same row only one can proceed. Every
   * write stamps `updated_at` from the application clock (millisecond
   * precision) rather than `now()` (microseconds), so the value a reader gets
   * back is exactly the value it can compare against.
   */
  expectedUpdatedAt?: Date;
  /** Last guard on the finishing write: refuse if an output is already stored. */
  requireNoOutput?: boolean;
  patch: JobPatch;
}

/** What a job took from the balance. Read from the ledger, which is the record. */
export interface JobCredits {
  reserved: number;
  refunded: number;
}

export interface CostEntry {
  userId: string | null;
  jobId: string;
  provider: string;
  model: string;
  kind: string;
  costUsd: number;
  meta?: Record<string, unknown>;
}

export interface JobStore {
  /**
   * Insert the job unless `(user_id, request_id)` is taken, in which case the
   * existing row comes back with `created: false`. Atomic: two deliveries of
   * one submission cannot both create a job.
   */
  create(input: CreateJobInput): Promise<CreateJobResult>;
  find(userId: string, jobId: string): Promise<JobRecord | null>;
  findByRequest(userId: string, requestId: string): Promise<JobRecord | null>;
  /** Conditional update. Null when the conditions did not hold — someone else got there first. */
  transition(input: TransitionInput): Promise<JobRecord | null>;
  /** Used only to undo a job that could not be paid for, so none is left behind. */
  remove(userId: string, jobId: string): Promise<void>;
  credits(jobId: string): Promise<JobCredits>;

  /**
   * Hold this job's estimated provider cost against the daily cap and write
   * the `reserved` row in `provider_costs`, in one atomic step.
   *
   * These used to be two calls with nothing between them — read the day's
   * total, decide, then insert — so concurrent starts all read the same total
   * and all found room. `{ ok: false }` means the cap would have been passed
   * and nothing was written.
   */
  reserveCost(entry: CostEntry, capUsd: number): Promise<{ ok: true } | { ok: false; spentUsd: number }>;
  /** Settle it once the call is over. `costUsd` replaces the estimate with what really happened. */
  settleCost(input: { jobId: string; status: "done" | "refunded"; costUsd?: number; meta?: Record<string, unknown> }): Promise<void>;
  /** Everything we have spent today across all users, in dollars. Refunded rows do not count. */
  spentTodayUsd(now: Date): Promise<number>;
}

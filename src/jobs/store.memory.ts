import type { CostEntry, CreateJobResult, JobStore, TransitionInput } from "./store";
import type { JobRecord } from "./types";

/* An in-memory JobStore for tests. It keeps the guarantees the Postgres store
   gets from a unique index and a conditional UPDATE: `create` is serialised per
   (user, requestId) and `transition` re-reads the row inside the same
   critical section, so two callers racing a claim cannot both win. */

interface CostRow {
  jobId: string;
  userId: string | null;
  provider: string;
  model: string;
  kind: string;
  costUsd: number;
  status: "reserved" | "done" | "refunded";
  createdAt: Date;
  meta: Record<string, unknown>;
}

/** Enough of a `credit_ledger` row to work out what a job took. */
export interface LedgerLike {
  jobId: string | null;
  reason: string;
  delta: number;
}

export interface MemoryJobStore extends JobStore {
  jobs: Map<string, JobRecord>;
  costs: CostRow[];
  /** Move a job's clock back, to make it look stuck without waiting ten minutes. */
  age(jobId: string, milliseconds: number): void;
}

/** Serialises calls that share a key, the way a unique index or a row lock does. */
function keyedQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return async function withLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const next = previous.then(async () => {
      // A microtask turn between taking the lock and running the body, so a
      // racing caller really is queued rather than accidentally interleaved.
      await Promise.resolve();
      return fn();
    });
    tails.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  };
}

/**
 * `ledger` is the rows the fake credit store has written, so the two fakes
 * agree about what a job took without either of them owning the other.
 */
export function memoryJobStore(ledger: () => readonly LedgerLike[] = () => []): MemoryJobStore {
  const jobs = new Map<string, JobRecord>();
  const costs: CostRow[] = [];
  const withLock = keyedQueue();
  let sequence = 0;

  const clone = (job: JobRecord): JobRecord => ({ ...job, input: { ...job.input }, output: job.output ? { ...job.output } : null });

  const store: MemoryJobStore = {
    jobs,
    costs,
    age(jobId, milliseconds) {
      const job = jobs.get(jobId);
      if (job) job.updatedAt = new Date(job.updatedAt.getTime() - milliseconds);
    },

    async create(input): Promise<CreateJobResult> {
      return withLock(`create:${input.userId}:${input.requestId}`, () => {
        const existing = [...jobs.values()].find((j) => j.userId === input.userId && j.requestId === input.requestId);
        if (existing) return { job: clone(existing), created: false };
        const stamp = new Date();
        const job: JobRecord = {
          id: `job_${String(++sequence).padStart(4, "0")}`,
          userId: input.userId,
          avatarId: input.avatarId,
          kind: input.kind,
          status: "queued",
          requestId: input.requestId,
          provider: null,
          providerRequestId: null,
          input: input.input,
          output: null,
          error: null,
          credits: input.credits,
          createdAt: stamp,
          updatedAt: stamp,
        };
        jobs.set(job.id, job);
        return { job: clone(job), created: true };
      });
    },

    async find(userId, jobId) {
      const job = jobs.get(jobId);
      return job && job.userId === userId ? clone(job) : null;
    },

    async findByRequest(userId, requestId) {
      const job = [...jobs.values()].find((j) => j.userId === userId && j.requestId === requestId);
      return job ? clone(job) : null;
    },

    async transition({ userId, jobId, from, expectedUpdatedAt, requireNoOutput, patch }: TransitionInput) {
      return withLock(`job:${jobId}`, () => {
        const job = jobs.get(jobId);
        if (!job || job.userId !== userId) return null;
        if (!from.includes(job.status)) return null;
        if (expectedUpdatedAt && job.updatedAt.getTime() !== expectedUpdatedAt.getTime()) return null;
        if (requireNoOutput && job.output !== null) return null;
        Object.assign(job, patch, { updatedAt: new Date(job.updatedAt.getTime() + ++sequence) });
        return clone(job);
      });
    },

    async remove(userId, jobId) {
      const job = jobs.get(jobId);
      if (job && job.userId === userId) jobs.delete(jobId);
    },

    async credits(jobId) {
      const rows = ledger().filter((row) => row.jobId === jobId);
      const sum = (reason: string) =>
        rows.filter((row) => row.reason === reason).reduce((total, row) => total + row.delta, 0);
      return {
        /* `|| 0` because negating a zero sum gives -0, and a job that reserved
           nothing — the free photo — would then report `creditsCharged: -0`.
           Postgres says 0 here (`coalesce(-sum(...), 0)` over no rows), and a
           fake that disagrees with the real store is how a test comes to
           prove the wrong thing. */
        reserved: -sum("job_reserve") || 0,
        refunded: sum("job_refund"),
      };
    },

    async reserveCost(entry: CostEntry, capUsd: number) {
      /* One statement in Postgres; one synchronous block here, which is the
         same guarantee: nothing can interleave between the sum and the push. */
      const spentUsd = costs.filter((cost) => cost.status !== "refunded").reduce((sum, cost) => sum + cost.costUsd, 0);
      if (spentUsd + entry.costUsd > capUsd + 1e-9) return { ok: false as const, spentUsd };
      costs.push({ ...entry, meta: entry.meta ?? {}, status: "reserved", createdAt: new Date() });
      return { ok: true as const };
    },

    async settleCost({ jobId, status, costUsd, meta }) {
      for (const cost of costs) {
        if (cost.jobId === jobId && cost.status === "reserved") {
          cost.status = status;
          if (costUsd !== undefined) cost.costUsd = costUsd;
          cost.meta = { ...cost.meta, ...(meta ?? {}) };
        }
      }
    },

    async spentTodayUsd() {
      return costs.filter((cost) => cost.status !== "refunded").reduce((sum, cost) => sum + cost.costUsd, 0);
    },
  };

  return store;
}

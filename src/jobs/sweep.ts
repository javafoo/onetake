import { STUCK_AFTER_MS } from "./index";
import type { JobKind } from "./types";

/* The sweep: what the every-minute cron does with the jobs nobody is asking
   about. Pure apart from the poll it is handed, so which rows it takes and
   what it does with each is tested without a database or a request.

   A job only moves when something polls it. The Create page polls while it
   is open, and Claude polls with check_post while it cares; when both stop, a
   run or a clip would sit half done, holding the credits reserved for its
   children, until she next opened the page. The sweep is a third poller with
   no opinions of its own: it calls the same poll functions, as the job's own
   user, and the claim every step takes (a conditional update on `updated_at`)
   decides who does the work when two of them arrive at once.

   Which kinds, and after how long:

   - `agent`, `story`, `stories` and `clip` are poll-driven (`POLL_DRIVEN`): a poll is
     what takes their next step, so one left alone for a minute is taken. A
     clip counts whether a run started it or she did from the library; only
     the second is swept directly (see top level, below).
   - `image`, `reel`, `carousel`, `text_photo` and `plan` do all their work in
     one go after the response that started them. A poll only reads them, so
     sweeping them every minute would do nothing. But when the invocation
     doing that work dies (a deploy, a timeout), the job sits "running" with
     its credits reserved until somebody looks, and nobody may. So they are
     taken only once past `STUCK_AFTER_MS`, when a poll writes them off and
     refunds them: the one thing a look can do for them.
   - `stitch` is always a child of a video run and never top level.

   Top level: a child job's request id is its parent's id plus a step
   (`<run>:photo:0`, `<run>:still:1`), and its parent polls it; sweeping it
   too would only race the parent. The one request id with a colon that is
   top level is the video run a one-message plan starts by itself
   (`<plan>:make`, `autoMakeRequestId`): nothing else polls that run once she
   closes the page, and its children hold credits. */

/** A poll-driven job untouched this long is taken. A browser or Claude polling it keeps it fresher than this. */
export const SWEEP_IDLE_MS = 60_000;
/** Rows one run takes. The rest are the oldest of the next run. */
export const SWEEP_LIMIT = 25;
/** Rows polled at once; see `runSweep`. */
export const SWEEP_CONCURRENCY = 3;
/**
 * No new row is started after this long.
 *
 * Work a poll schedules with `after()` (a photo, a reel, the next child)
 * runs after the cron's response, inside the same `maxDuration` of 300
 * seconds. A loop that used most of that would leave the work it started no
 * time to finish, and that work would then be written off as stuck ten
 * minutes later. Two minutes of polling leaves three for the work.
 */
export const SWEEP_BUDGET_MS = 120_000;

/** Kinds a poll moves along: taken after `SWEEP_IDLE_MS`. */
export const SWEPT_WHEN_IDLE: readonly JobKind[] = ["agent", "clip", "week"];
/** Kinds that run in one go after their response: taken only once a poll would write them off. */
export const SWEPT_WHEN_STUCK: readonly JobKind[] = ["image", "reel", "carousel", "text_photo"];

/** What the query hands over: nothing but who, which, and what kind. */
export type SweepRow = { userId: string; jobId: string; kind: JobKind };

/** Which of the app's polls a row gets. */
export type SweepPoll = "agent" | "week" | "job";

/** The poll the app's own screen uses for this kind. Null for a kind the sweep never takes. */
export function sweepPoll(kind: JobKind): SweepPoll | null {
  if (kind === "agent") return "agent";
  // A week keeps going when she leaves the page: the sweep takes its next stage.
  if (kind === "week") return "week";
  return "job";
}

/** True when nothing else polls this job: not a child of a run. The same rule the query writes in SQL. */
export function isTopLevel(kind: JobKind, requestId: string): boolean {
  void kind;
  return !requestId.includes(":");
}

/** The two `updated_at` cutoffs, from one clock reading. */
export function sweepCutoffs(now: Date): { idle: Date; stuck: Date } {
  return { idle: new Date(now.getTime() - SWEEP_IDLE_MS), stuck: new Date(now.getTime() - STUCK_AFTER_MS) };
}

/** True when a row of this kind, last touched at `updatedAt`, is due. The same rule the query writes in SQL. */
export function isDue(kind: JobKind, updatedAt: Date, now: Date): boolean {
  const { idle, stuck } = sweepCutoffs(now);
  if (SWEPT_WHEN_IDLE.includes(kind)) return updatedAt < idle;
  if (SWEPT_WHEN_STUCK.includes(kind)) return updatedAt < stuck;
  return false;
}

/** Counts only: no ids of anybody's jobs leave the route. */
export type SweepSummary = {
  found: number;
  /** Polled and still hers. */
  polled: number;
  /** Polled and not found: finished and gone, or deleted with her account in between. */
  gone: number;
  /** A poll threw; logged, and the rest went on. */
  errors: number;
  /** Not started because the time ran out; the next run takes them. */
  skipped: number;
};

export interface SweepDeps {
  /** One poll of one row, as that row's own user. True when the job was found. */
  poll(row: SweepRow): Promise<boolean>;
  /** Told about a poll that threw, to log it. */
  failed(row: SweepRow, error: unknown): void;
  /** Milliseconds, for the budget. */
  clock(): number;
  budgetMs?: number;
  concurrency?: number;
}

/**
 * Poll every row, a few at a time, until the rows or the time run out.
 *
 * Three at a time rather than one: an agent step can make a model call of
 * several seconds, and twenty-five of those one after another would eat the
 * time the work they start needs (see `SWEEP_BUDGET_MS`). Not more than
 * three, because each poll holds database connections and may call a
 * provider, and a burst of them every minute is exactly what the free
 * database branch runs out of memory on. Rows are distinct jobs, so no two
 * workers ever hold the same one; two jobs of one account may run side by
 * side, as her own two tabs could.
 *
 * One row failing does not stop the others: it is counted, handed to
 * `failed`, and the worker takes the next.
 */
export async function runSweep(rows: readonly SweepRow[], deps: SweepDeps): Promise<SweepSummary> {
  const budget = deps.budgetMs ?? SWEEP_BUDGET_MS;
  const started = deps.clock();
  const summary: SweepSummary = { found: rows.length, polled: 0, gone: 0, errors: 0, skipped: 0 };
  let next = 0;

  async function worker(): Promise<void> {
    while (next < rows.length) {
      const row = rows[next++];
      if (deps.clock() - started >= budget) {
        summary.skipped++;
        continue;
      }
      try {
        if (await deps.poll(row)) summary.polled++;
        else summary.gone++;
      } catch (error) {
        summary.errors++;
        deps.failed(row, error);
      }
    }
  }

  const workers = Math.max(1, Math.min(deps.concurrency ?? SWEEP_CONCURRENCY, rows.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return summary;
}

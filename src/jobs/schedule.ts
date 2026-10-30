/* How work that outlives the response gets to run.

   Next's `after()` extends the serverless invocation until the callback
   settles, which is what makes "return the job id now, do the work in a
   moment" possible on Vercel without a queue. It only works inside a request,
   so outside one — a CLI script, a test — the task is simply started. Tests
   pass their own scheduler and never rely on either path. */

import { logUnexpected } from "@/lib/errors";

export type Scheduler = (task: () => Promise<void>) => void;

/** Never let a background task reject: an unhandled rejection kills the process. */
function swallow(task: () => Promise<void>): Promise<void> {
  return task().catch((error) => {
    // Scrubbed and cut to size: a provider error can quote a request, headers and all.
    logUnexpected("jobs.background", error);
  });
}

export const afterResponse: Scheduler = (task) => {
  /* Imported here rather than at the top of the file so `src/jobs` can be used
     from a script or a test without pulling in the Next server runtime. The
     import settles in a microtask, still inside the request's async context,
     so `after` is registered against the right invocation. */
  void import("next/server")
    .then(({ after }) => after(() => swallow(task)))
    .catch(() => {
      // Not in a request (a script, a test): just run it.
      void swallow(task);
    });
};

/** Runs the task immediately and waits for it. Used by scripts and the tests. */
export const inline: Scheduler = (task) => {
  void swallow(task);
};

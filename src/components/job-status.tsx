"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { creditWord } from "@/components/ui/button";

/* Watches one job and says where it got to.
 *
 * The poll is what moves the job along — GET /api/jobs/[id] checks the
 * provider, stores a finished clip and writes off a dead job — so this keeps
 * asking until the job is over. Drop it under any form whose action returns a
 * `jobId`:
 *
 *   const [state, action] = useActionState(generateSceneAction, null);
 *   {state?.jobId && <JobStatus jobId={state.jobId} />}
 *
 * It refreshes the page itself when the job finishes, so the library, the
 * draft and the credit balance come back with the new row in them.
 */

export type JobStatusValue = {
  id: string;
  /** The job's kind, or for an agent run the kind of thing it makes. */
  kind: string;
  status: "queued" | "running" | "completed" | "failed";
  error: string | null;
  mediaIds: string[];
  message: string | null;
  credits: number;
  creditsCharged: number;
  creditsRefunded: number;
  createdAt: string;
  updatedAt: string;
  /** The draft the work landed on, when the poll knows it (an agent run that wrote one). */
  draftId?: string | null;
};

export type JobStatusProps = {
  /** From the action's `{ jobId }`. */
  jobId: string;
  /** Where to ask. Default `/api/jobs/<jobId>`; an agent run is asked through `/api/agent/<jobId>`. */
  url?: string;
  /** Turns what `url` answers into a job status. Default: it already is one. */
  read?: (body: unknown) => JobStatusValue;
  /** How often to ask, in milliseconds. Default 2500. */
  pollMs?: number;
  /** Called once, with the finished job, whether it worked or not. */
  onFinished?: (job: JobStatusValue) => void;
  /** Set false to keep the page as it is when the job finishes. Default true. */
  refreshOnFinish?: boolean;
  /** Shown while the job is queued or running, instead of the default line. */
  workingLabel?: string;
  /** Renders the result yourself instead of the built-in preview. */
  children?: (job: JobStatusValue) => React.ReactNode;
  className?: string;
};

const WORKING = new Set(["queued", "running"]);

export function JobStatus({
  jobId,
  url,
  read,
  pollMs = 2500,
  onFinished,
  refreshOnFinish = true,
  workingLabel,
  children,
  className = "",
}: JobStatusProps) {
  const router = useRouter();
  /* Kept together and stamped with the job they describe, so pointing this at
     a different job shows nothing rather than the last one's result, without
     an effect that clears state and re-renders twice. */
  const [seen, setSeen] = useState<{ jobId: string; job: JobStatusValue | null; problem: string | null }>({
    jobId,
    job: null,
    problem: null,
  });
  const current = seen.jobId === jobId ? seen : { jobId, job: null, problem: null };
  const job = current.job;
  const problem = current.problem;
  const finished = useRef(false);

  useEffect(() => {
    finished.current = false;

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    async function ask() {
      try {
        const response = await fetch(url ?? `/api/jobs/${jobId}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(response.status === 404 ? "That has finished or was removed. Reload the page." : "Could not reach the server.");
        const body: unknown = await response.json();
        const next = read ? read(body) : (body as JobStatusValue);
        if (stopped) return;
        setSeen({ jobId, job: next, problem: null });
        if (WORKING.has(next.status)) {
          timer = setTimeout(ask, pollMs);
          return;
        }
        if (!finished.current) {
          finished.current = true;
          onFinished?.(next);
          if (refreshOnFinish) router.refresh();
        }
      } catch (error) {
        if (stopped || controller.signal.aborted) return;
        // A dropped connection is not a failed job: say so quietly and keep asking.
        setSeen((previous) => ({
          jobId,
          job: previous.jobId === jobId ? previous.job : null,
          problem: error instanceof Error ? error.message : "Could not reach the server.",
        }));
        timer = setTimeout(ask, Math.max(pollMs, 5000));
      }
    }

    void ask();
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
    // onFinished and read are intentionally not dependencies: a new inline
    // function on every render would restart the poll on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, url, pollMs, refreshOnFinish, router]);

  const status = job?.status ?? "queued";

  return (
    <div role="status" aria-live="polite" className={`rounded-lg border border-line bg-white p-4 text-sm ${className}`}>
      {WORKING.has(status) && (
        <p className="text-muted">
          {workingLabel ?? (status === "queued" ? "Queued…" : "Working on it…")}
          {problem ? ` (${problem} Still trying.)` : ""}
        </p>
      )}

      {job && status === "completed" && (
        <div className="space-y-3">
          <p className="text-emerald-700">{job.message ?? "Done."}</p>
          {children ? children(job) : <Preview job={job} />}
          <p className="text-xs text-muted">
            {job.creditsCharged > 0 ? `${creditWord(job.creditsCharged)} used.` : "No credits used."}
          </p>
        </div>
      )}

      {job && status === "failed" && (
        <div className="space-y-1">
          <p className="text-red-700">{job.error ?? "This did not work."}</p>
          <p className="text-xs text-muted">
            {job.creditsRefunded > 0
              ? `Your ${creditWord(job.creditsRefunded)} ${job.creditsRefunded === 1 ? "was" : "were"} returned.`
              : job.creditsCharged > 0
                ? `Used: ${creditWord(job.creditsCharged)}, for the steps that finished.`
                : "You were not charged for this."}
          </p>
        </div>
      )}
    </div>
  );
}

/** The result, rendered the obvious way. Media is only ever served through /api/media/[id]. */
function Preview({ job }: { job: JobStatusValue }) {
  if (job.mediaIds.length === 0) return null;
  const moving = job.kind === "clip" || job.kind === "reel";
  return (
    <div className="flex flex-wrap gap-3">
      {job.mediaIds.map((id) =>
        moving ? (
          <video key={id} src={`/api/media/${id}`} controls playsInline className="w-48 rounded-lg border border-line" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={id} src={`/api/media/${id}`} alt="The photo just made" className="w-48 rounded-lg border border-line" />
        ),
      )}
    </div>
  );
}

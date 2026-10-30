import Link from "next/link";

import type { Progress } from "@/app/onboarding/flow";

/* The bar at the top of every setup screen. It answers the two questions
   someone asks on a phone at the third question in a row: how much of this is
   left, and can I stop. */

export function SetupProgress({ progress, back }: { progress: Progress; back?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="eyebrow min-w-0 truncate text-muted">
          {back ? (
            <Link href={back} className="text-muted underline decoration-line-strong underline-offset-4 hover:text-ink">
              Back
            </Link>
          ) : (
            "Setup"
          )}
          <span aria-hidden="true"> · </span>
          <span className="text-ink-soft">{progress.label}</span>
        </p>
        <p className="shrink-0 text-2xs font-medium text-muted tabular-nums">
          {progress.step} of {progress.total}
        </p>
      </div>
      <div
        role="progressbar"
        aria-valuenow={progress.step}
        aria-valuemin={1}
        aria-valuemax={progress.total}
        aria-label={`Setup: step ${progress.step} of ${progress.total}`}
        className="h-1 w-full overflow-hidden rounded-full bg-sunken"
      >
        <span
          className="block h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${Math.round(progress.ratio * 100)}%` }}
        />
      </div>
    </div>
  );
}

/** The question at the top of a step. Display serif, one line of help under it. */
export function Ask({ children, help }: { children: React.ReactNode; help?: React.ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="font-display text-2xl tracking-tight text-balance text-ink sm:text-3xl">{children}</h1>
      {help && <p className="mt-2 text-sm text-pretty text-ink-soft">{help}</p>}
    </header>
  );
}

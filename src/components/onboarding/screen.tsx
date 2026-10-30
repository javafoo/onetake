import Link from "next/link";
import type { ReactNode } from "react";

import { isInterviewStage, progressFor, STAGES, stagePath, type Stage } from "@/app/onboarding/flow";
import { step } from "@/onboarding/steps";

import { SetupProgress } from "./progress";

/* The frame every setup screen sits in: where you are, how much is left, and
   the way out.

   It belongs to the page and not to the layout above it. A layout is not
   re-rendered when only the segment under it changes, so a progress bar living
   there reads one screen behind after every "Continue" — which is precisely the
   number a person is watching. */

export function SetupScreen({ stage, children }: { stage: Stage; children: ReactNode }) {
  const index = STAGES.indexOf(stage);
  const back = index > 0 ? stagePath(STAGES[index - 1]) : undefined;
  const progress = progressFor(stage, isInterviewStage(stage) ? step(stage).title : undefined);

  return (
    <>
      <div className="sticky top-0 z-20 -mx-gutter bg-canvas/95 px-gutter pt-1 pb-3 backdrop-blur sm:-mx-8 sm:px-8">
        <SetupProgress progress={progress} back={back} />
      </div>

      <div className="pt-6">{children}</div>

      <footer className="mt-10 border-t border-line pt-4 text-center">
        <Link
          href="/onboarding/paused"
          className="inline-flex min-h-11 items-center text-sm text-muted underline decoration-line-strong underline-offset-4 hover:text-ink"
        >
          Save and finish later
        </Link>
        <p className="mt-1 text-xs text-muted">Everything you have answered is already saved.</p>
      </footer>
    </>
  );
}

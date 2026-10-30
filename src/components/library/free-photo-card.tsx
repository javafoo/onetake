"use client";

import { useActionState, useState } from "react";

import type { ActionState } from "@/app/actions";
import { PHOTO_CREDITS, creditsWord } from "@/billing/gate";
import { JobStatus, type JobStatusValue } from "@/components/job-status";
import { buttonClass } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { ResultMessage } from "@/components/ui/message";

/* "Your free first photo", at the top of the Library.
 *
 * Every account gets one free photo for its lifetime. Accounts that finished
 * setup before that screen existed never saw the offer, and anyone can skip it,
 * so the Library keeps offering until it is spent. Once it is spent this card
 * is not rendered at all — the page decides that, from the `users` row.
 *
 * It sits above the paid drawers and looks different from them: the drawers are
 * closed and wear the brass "this costs money" skin, and this one is open and
 * does not.
 */

type Props = {
  suggestion: string;
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  /** False when Clerk says her address is unconfirmed. The button is replaced by why. */
  emailVerified: boolean;
};

export function FreePhotoCard({ suggestion, action, emailVerified }: Props) {
  const [idea, setIdea] = useState(suggestion);
  const [done, setDone] = useState<JobStatusValue | null>(null);
  const [state, formAction, pending] = useActionState(async (previous: ActionState, form: FormData) => {
    form.set("requestId", crypto.randomUUID());
    return action(previous, form);
  }, null);

  const finished = done?.status === "completed" && done.mediaIds.length > 0;

  return (
    <section className="mb-6 rounded-xl border border-good/30 bg-good-soft p-4 sm:p-6">
      <h2 className="font-display text-lg text-ink">Your free first photo</h2>
      <p className="mt-1.5 max-w-prose text-sm text-ink-soft">
        One photo on us, once per account. No credits, no card. Say where she is and we will make it.
      </p>

      {!finished && (
        <form action={formAction} aria-busy={pending} className="mt-4 space-y-4">
          <label className="block">
            <span className="block text-sm font-medium text-ink">Where is she?</span>
            <Textarea
              name="idea"
              rows={2}
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
              className="mt-2"
              disabled={pending || Boolean(state?.jobId)}
            />
          </label>

          {emailVerified ? (
            <button
              type="submit"
              disabled={pending || Boolean(state?.jobId)}
              className={buttonClass("primary", "md", "w-full sm:w-auto")}
            >
              {pending ? "Starting…" : state?.jobId ? "Making your photo…" : "Make it, free"}
            </button>
          ) : (
            <p className="max-w-prose text-sm text-ink-soft">
              <strong className="font-semibold">Confirm your email first.</strong> The photo is free, so we ask for a
              confirmed address before giving one away. Confirm your email address with the code or link we sent, then
              reload this page — your free photo will still be here.
            </p>
          )}

          {state && !state.ok && <ResultMessage ok={false}>{state.message}</ResultMessage>}
        </form>
      )}

      {state?.jobId && (
        <JobStatus
          key={state.jobId}
          jobId={state.jobId}
          className="mt-4"
          workingLabel="Writing the prompt, generating, and checking her face. About a minute."
          /* No refresh: a reload would re-read the row, find the freebie spent
             and take this card away with the photo still on it. The photo is
             in the Library either way, one scroll down, after the next visit. */
          refreshOnFinish={false}
          onFinished={setDone}
        >
          {(job) =>
            job.mediaIds.length > 0 ? (
              <figure>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/media/${job.mediaIds[0]}`}
                  alt="Your free photo of her"
                  className="w-full max-w-sm rounded-xl border border-line"
                />
                <figcaption className="mt-3">
                  <p className="font-display text-lg text-ink">This is what a photo looks like</p>
                  <p className="mt-1 text-sm text-ink-soft">From here each one costs {creditsWord(PHOTO_CREDITS)}.</p>
                </figcaption>
              </figure>
            ) : null
          }
        </JobStatus>
      )}
    </section>
  );
}

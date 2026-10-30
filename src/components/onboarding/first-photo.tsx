"use client";

import { useActionState, useState } from "react";

import type { ActionState } from "@/app/actions";
import { CLIP_CREDITS, CLIP_NOUN, PHOTO_CREDITS, creditsWord } from "@/billing/gate";
import { JobStatus, type JobStatusValue } from "@/components/job-status";
import { buttonClass } from "@/components/ui/button";
import { ResultMessage } from "@/components/ui/message";
import { Textarea } from "@/components/ui/field";

/* Her first photo: one free generation, and the first time she sees the thing
 * she has spent ten minutes describing.
 *
 * The scene is suggested, not decided. It comes from her own identity lock, so
 * it is somewhere she said she is photographed, and it is in a box she can
 * rewrite. One button, one price (none), and a skip that is always there.
 *
 * The result is shown large and on its own. Everything else on this screen is
 * small, because this is the payoff and a thumbnail of it would be a wasted
 * moment.
 */

type Props = {
  /** One scene from her identity lock, already filled into the box. */
  suggestion: string;
  generate: (state: ActionState, form: FormData) => Promise<ActionState>;
  /** Leaves setup for the Overview. The same action whether she took the photo or not. */
  openOverview: (state: ActionState, form: FormData) => Promise<ActionState>;
  /**
   * Why she cannot press the button, or null when she can. The button is
   * replaced by the reason rather than disabled: a disabled button explains
   * nothing and still invites a tap.
   */
  blocked: "unverified_email" | "already_used" | null;
};

export function FirstPhotoStudio({ suggestion, generate, openOverview, blocked }: Props) {
  const [idea, setIdea] = useState(suggestion);
  const [done, setDone] = useState<JobStatusValue | null>(null);

  const [state, formAction, pending] = useActionState(async (previous: ActionState, form: FormData) => {
    form.set("requestId", crypto.randomUUID());
    return generate(previous, form);
  }, null);

  /* The way out. It redirects on success, so its state is only ever a refusal. */
  const [leaving, leaveAction, leavePending] = useActionState(async (previous: ActionState, form: FormData) => {
    form.set("requestId", crypto.randomUUID());
    return openOverview(previous, form);
  }, null);

  /* Once the photo is there the form is gone. Offering "make another free one"
     would be offering something that does not exist. */
  const finished = done?.status === "completed" && done.mediaIds.length > 0;

  return (
    <div className="space-y-6">
      {!finished && (
        <form action={formAction} aria-busy={pending} className="space-y-5">
          <label className="block">
            <span className="block text-sm font-medium text-ink">Where is she?</span>
            <span className="mt-1 block text-xs text-muted">
              Taken from the places you said she is photographed. Change it to anywhere you like.
            </span>
            <Textarea
              name="idea"
              rows={3}
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
              className="mt-2"
              disabled={pending || Boolean(state?.jobId)}
            />
          </label>

          {blocked === null && (
            <div className="flex flex-col gap-2">
              <button
                type="submit"
                disabled={pending || Boolean(state?.jobId)}
                className={buttonClass("primary", "lg", "w-full")}
              >
                {pending ? "Starting…" : state?.jobId ? "Making her photo…" : "Make her first photo, free"}
              </button>
              <p className="text-center text-xs text-muted">
                About a minute. This one is on us and costs no credits.
              </p>
            </div>
          )}

          {blocked === "unverified_email" && (
            <div className="rounded-xl border border-warn/25 bg-warn-soft px-4 py-5">
              <p className="font-display text-lg text-ink">Confirm your email first</p>
              <p className="mt-1.5 max-w-prose text-sm text-ink-soft">
                The first photo is free, so we ask for a confirmed email address before giving one away. Confirm your
                email address with the code or link we sent, then reload this page — your free photo will still be
                waiting. Or skip it for now: it stays on your account and your Library will offer it again.
              </p>
            </div>
          )}

          {blocked === "already_used" && (
            <div className="rounded-xl border border-line-strong bg-sunken px-4 py-5">
              <p className="font-display text-lg text-ink">This account has had its free photo</p>
              <p className="mt-1.5 max-w-prose text-sm text-ink-soft">
                There is one per account, and it has been used. Everything from here is paid for with credits — a photo
                is {creditsWord(PHOTO_CREDITS)}, a {CLIP_NOUN} is {creditsWord(CLIP_CREDITS)}.
              </p>
            </div>
          )}

          {state && !state.ok && <ResultMessage ok={false}>{state.message}</ResultMessage>}
        </form>
      )}

      {state?.jobId && (
        <JobStatus
          key={state.jobId}
          jobId={state.jobId}
          workingLabel="Writing the prompt, generating, and checking her face. About a minute."
          /* The page must not refresh under her: a reload would re-read the
             flow, see the freebie spent and move her on before she has looked
             at the photo. */
          refreshOnFinish={false}
          onFinished={setDone}
        >
          {(job) =>
            job.mediaIds.length > 0 ? (
              <figure className="mt-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/media/${job.mediaIds[0]}`}
                  alt="The first photo of her"
                  className="w-full rounded-xl border border-line"
                />
                <figcaption className="mt-3">
                  <p className="font-display text-xl text-ink">That is her</p>
                  <p className="mt-1 text-sm text-ink-soft">
                    {`She is in your Library now. From here each photo costs ${creditsWord(PHOTO_CREDITS)}, paid from your free credits.`}
                  </p>
                </figcaption>
              </figure>
            ) : null
          }
        </JobStatus>
      )}

      <form action={leaveAction} className="border-t border-line pt-5">
        <button
          type="submit"
          disabled={leavePending}
          className={buttonClass(finished ? "primary" : "quiet", "lg", "w-full")}
        >
          {leavePending ? "Opening Overview…" : finished ? "Take me to Overview" : "Skip for now"}
        </button>
        {!finished && (
          <p className="mt-2 text-center text-xs text-muted">
            The free photo stays on your account. Your Library will offer it again whenever you want it.
          </p>
        )}
        {leaving && !leaving.ok && (
          <div className="mt-2">
            <ResultMessage ok={false}>{leaving.message}</ResultMessage>
          </div>
        )}
      </form>

      {!finished && (
        <p className="text-center text-xs text-muted">
          Photos only — clips are not part of this. A {CLIP_NOUN} costs {creditsWord(CLIP_CREDITS)} later.
        </p>
      )}
    </div>
  );
}

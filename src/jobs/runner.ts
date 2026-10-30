import { agentStep, type AgentDeps, type ChildJobs } from "@/agent/step";
import { weekStep, type WeekDeps } from "@/week/step";

import type { JobProviders, StepOutcome } from "./providers";
import type { JobStore } from "./store";
import type { AgentJobInput, CarouselJobInput, ClipJobInput, ImageJobInput, JobKind, JobRecord, ReelJobInput, TextPhotoJobInput, WeekJobInput } from "./types";

/* One step of one job.

   Everything here is called with a job the caller has already claimed, so a
   step may assume it is the only one running. It either finishes the job,
   leaves it running for the next poll, or throws — and a throw is always a
   failure that refunds, which is what keeps "reserved, then done or refunded"
   true no matter where it breaks. */

/** Kinds whose work is done by the client polling, rather than in one go after the response. */
export const POLL_DRIVEN: ReadonlySet<JobKind> = new Set<JobKind>(["clip", "agent", "week"]);

export type Step =
  | { done: false }
  | { done: true; outcome: StepOutcome }
  | { done: true; failed: true; message: string };

export interface StepContext {
  store: JobStore;
  providers: JobProviders;
  now?: () => Date;
  /** How an agent run starts and polls its child jobs. Bound to the run's owner by `src/jobs/index.ts`. */
  children?: ChildJobs;
  /** The agent's model calls and reads, replaceable in tests. */
  agent?: AgentDeps;
  /** The week's calls and reads, replaceable in tests. */
  week?: WeekDeps;
}

/**
 * How long a clip may keep being polled after it was submitted.
 *
 * A poll is one HTTP question to the provider, and a provider has bad minutes:
 * on 2026-09-22 a single status call failed 25 seconds into a clip that the
 * provider then finished two minutes later, and the job had already been
 * written off and refunded. So a poll that throws is not a verdict; it is
 * tried again next time until this much time has passed since submission.
 * Omni answers in a minute or two; fifteen is a ceiling.
 */
export const CLIP_DEADLINE_MS = 15 * 60 * 1000;

/**
 * How long a clip may sit "pending" at the provider before it is given up on.
 *
 * A provider that answers "still working" is not a provider that has failed,
 * so this is longer than `CLIP_DEADLINE_MS` and twice the longest render seen.
 * Without it a request the provider lost or queued behind an outage stayed
 * "running" for good, and the credits reserved for it were held for good.
 * Past this the job fails and refunds; a clip the provider finishes afterwards
 * is not collected.
 */
export const CLIP_PENDING_DEADLINE_MS = 30 * 60 * 1000;

const CLIP_GAVE_UP = "The video service did not finish this clip in half an hour, so it was stopped. Nothing was charged.";

export async function runStep(job: JobRecord, context: StepContext): Promise<Step> {
  switch (job.input.kind) {
    case "image":
      return { done: true, outcome: await context.providers.generateImage(job, job.input as ImageJobInput) };
    case "reel":
      return { done: true, outcome: await context.providers.assembleReel(job, job.input as ReelJobInput) };
    case "clip":
      return clipStep(job, job.input as ClipJobInput, context);
    case "carousel":
      /* Writing, checking and rendering all happen in this one step: none of
         it waits on another company, so there is nothing to poll for. It is
         slow enough to be a job (a model call and ten canvases) and that is
         all. */
      return { done: true, outcome: await context.providers.renderCarousel(job, job.input as CarouselJobInput) };
    case "text_photo":
      // A canvas and one cached face look: seconds, in one go.
      return { done: true, outcome: await context.providers.renderTextPhoto(job, job.input as TextPhotoJobInput) };
    case "agent":
      /* One step of the run per poll: write, decide, or start or check a
         child job. The children are ordinary jobs and pay their own way. */
      return agentStep(job, job.input as AgentJobInput, context);
    case "week":
      // One stage of the week per poll; its posts are agent runs, started and checked like children.
      return weekStep(job, job.input as WeekJobInput, context);
  }
}

async function clipStep(job: JobRecord, input: ClipJobInput, { store, providers, now }: StepContext): Promise<Step> {
  if (!job.providerRequestId) {
    const submission = await providers.submitClip(job, input);
    /* No claim condition on this write. The generation is already paid for at
       the provider; losing its request id here would mean paying for a clip we
       can never collect, so it lands whatever else has happened to the row. */
    await store.transition({
      userId: job.userId,
      jobId: job.id,
      from: ["queued", "running"],
      patch: {
        status: "running",
        provider: submission.provider,
        providerRequestId: submission.requestId,
        input: { ...job.input, providerStatusUrl: submission.statusUrl },
      },
    });
    return { done: false };
  }

  try {
    const state = await providers.clipStatus(job);
    if (state.state === "pending") {
      const age = (now?.() ?? new Date()).getTime() - job.createdAt.getTime();
      if (age > CLIP_PENDING_DEADLINE_MS) {
        console.error(`clip ${job.id}: still ${state.status} after ${Math.round(age / 1000)}s, giving up`);
        return { done: true, failed: true, message: CLIP_GAVE_UP };
      }
      return { done: false };
    }
    if (state.state === "failed") {
      /* The page gets the plain sentence; the provider's own reason goes to
         the log under the job id so ops can find out what happened. */
      console.warn(`clip ${job.id}: provider ${state.status}: ${state.message.slice(0, 300)}`);
      return { done: true, failed: true, message: clipFailure(state.status) };
    }
    return { done: true, outcome: await providers.storeClip(job, input, state.videoUrl) };
  } catch (error) {
    /* The question failed, not the clip. The provider's own verdict comes
       back as `state`, above; a throw here is a network or service error on
       the way to it, or on the download after it. Both are retried by the
       next poll until the deadline, and the raw reason is logged with the
       job id so the day it is not transient there is something to read. */
    const raw = error instanceof Error ? error.message : String(error);
    const age = (now?.() ?? new Date()).getTime() - job.createdAt.getTime();
    if (age < CLIP_DEADLINE_MS) {
      console.warn(`clip ${job.id}: poll failed, will retry (${Math.round(age / 1000)}s in): ${raw.slice(0, 300)}`);
      return { done: false };
    }
    console.error(`clip ${job.id}: giving up after ${Math.round(age / 1000)}s: ${raw.slice(0, 300)}`);
    throw error;
  }
}

function clipFailure(status: string): string {
  if (status === "nsfw") return "The video service refused this one as unsafe. Try a different photo or wording.";
  if (status === "canceled") return "The video service cancelled this one.";
  return "The video service could not finish this clip.";
}

/**
 * What to show a person when something threw. Provider errors are useful in a
 * log and frightening in a page, so the handful we expect are translated and
 * everything else is passed through — our own errors are already written for
 * the person reading them.
 */
export function plainMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/^Gemini/.test(raw)) return "The image service could not finish this one.";
  if (/^Higgsfield/.test(raw) || /^Omni/.test(raw)) return "The video service could not finish this one.";
  if (/Upload failed/.test(raw)) return "The photo could not be sent to the video service.";
  if (/^No usable ffmpeg/.test(raw) || /^ffmpeg could not/.test(raw)) return "The video could not be rendered.";
  if (/Media not found/.test(raw)) return "That file is not in your library any more.";
  if (/^Missing [A-Z_]+$/.test(raw) || /must be set as/.test(raw)) return "This feature is not configured on the server.";
  /* A row whose bytes are not in storage. It happens when a storage driver is
     switched under an existing account, or when an object has gone. The
     pathname in the message is a filesystem path on our server, which is not
     hers to read and not something she can act on. */
  if (/^ENOENT/.test(raw) || /NoSuchKey|BlobNotFound|The requested blob does not exist/i.test(raw)) {
    return "One of the files this needs is missing from storage. Nothing was charged. Please tell us if it keeps happening.";
  }
  return raw;
}
